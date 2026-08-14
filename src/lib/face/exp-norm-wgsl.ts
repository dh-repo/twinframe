import { align5PointSimilarityTensor, createSafeCanvas } from "./similarity-transform.ts";
import type { SCRFDBoundingBox, SCRFDPose, ExpNormOptions } from "./types.ts";

export const EXP_NORM_WGSL_SHADER = /* wgsl */ `
struct ExpNormParams {
  srcWidth: f32,
  srcHeight: f32,
  outWidth: u32,
  outHeight: u32,
  yaw: f32,
  pitch: f32,
  roll: f32,
  bboxX: f32,
  bboxY: f32,
  bboxW: f32,
  bboxH: f32,
  pad0: f32,
  blendshapeAlpha: array<vec4<f32>, 3>, // 10 weights padded to 12 floats
};

@group(0) @binding(0) var<uniform> params: ExpNormParams;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;
@group(0) @binding(2) var textureSampler: sampler;
@group(0) @binding(3) var<storage, read> blendshapeBases: array<vec4<f32>>; // Base_0, B_1, ..., B_10
@group(0) @binding(4) var<storage, read_write> outputTensor: array<f32>;   // NCHW [1, 3, H, W]

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let u = global_id.x;
  let v = global_id.y;

  if (u >= params.outWidth || v >= params.outHeight) {
    return;
  }

  let numPixels = params.outWidth * params.outHeight;
  let pixelIndex = v * params.outWidth + u;

  // Base vertex coordinate S_base(u, v)
  let baseVertex = blendshapeBases[pixelIndex * 11u].xyz;

  // Subtract 10-basis blendshape expression residuals (sum alpha_i * B_i)
  var neutralPos = baseVertex;
  for (var i = 0u; i < 10u; i = i + 1u) {
    let alphaIdx = i / 4u;
    let alphaComp = i % 4u;
    let alpha = params.blendshapeAlpha[alphaIdx][alphaComp];
    let basisVector = blendshapeBases[pixelIndex * 11u + 1u + i].xyz;
    neutralPos = neutralPos - alpha * basisVector;
  }

  // Construct 3D rotation matrix R(yaw, pitch, roll)
  let cy = cos(params.yaw);
  let sy = sin(params.yaw);
  let cp = cos(params.pitch);
  let sp = sin(params.pitch);
  let cr = cos(params.roll);
  let sr = sin(params.roll);

  let R = mat3x3<f32>(
    vec3<f32>(cy * cr, cy * sr, -sy),
    vec3<f32>(sp * sy * cr - cp * sr, sp * sy * sr + cp * cr, sp * cy),
    vec3<f32>(cp * sy * cr + sp * sr, cp * sy * sr - sp * cr, cp * cy)
  );

  let rotatedPos = R * neutralPos;

  // Project onto 2D source image coordinates
  let normX = (rotatedPos.x + 0.5) * params.bboxW + params.bboxX;
  let normY = (rotatedPos.y + 0.5) * params.bboxH + params.bboxY;

  let uvCoords = vec2<f32>(normX / params.srcWidth, normY / params.srcHeight);

  // Bilinear sample from input source texture
  let sampledColor = textureSampleLevel(srcTexture, textureSampler, uvCoords, 0.0);

  // Normalize pixel values to [-1.0, 1.0] and write in NCHW layout
  let rNorm = (sampledColor.r * 255.0 - 127.5) / 128.0;
  let gNorm = (sampledColor.g * 255.0 - 127.5) / 128.0;
  let bNorm = (sampledColor.b * 255.0 - 127.5) / 128.0;

  outputTensor[0u * numPixels + pixelIndex] = rNorm;
  outputTensor[1u * numPixels + pixelIndex] = gNorm;
  outputTensor[2u * numPixels + pixelIndex] = bNorm;
}
`;

/** Cache of canonical 3D blendshape bases per output dimension */
const basesCache = new Map<number, Float32Array>();

/**
 * Generates canonical 3D base mesh vertices and 10 blendshape residual basis vectors for a target HxW grid.
 * Grid size: outWidth * outHeight * 11 * 4 floats (each vec4<f32>).
 */
export function getCanonicalBlendshapeBases(targetSize: 112 | 160 = 112): Float32Array {
  if (basesCache.has(targetSize)) {
    return basesCache.get(targetSize)!;
  }

  const numPixels = targetSize * targetSize;
  const numElementsPerPixel = 11 * 4; // 1 base + 10 bases, each vec4
  const data = new Float32Array(numPixels * numElementsPerPixel);

  for (let v = 0; v < targetSize; v++) {
    for (let u = 0; u < targetSize; u++) {
      const pixelIdx = v * targetSize + u;
      const baseOffset = pixelIdx * numElementsPerPixel;

      // Base vertex S_base(u, v) normalized to [-0.5, 0.5]
      const nx = (u + 0.5) / targetSize - 0.5;
      const ny = (v + 0.5) / targetSize - 0.5;
      const r2 = Math.max(0, 0.25 - nx * nx - ny * ny);
      const nz = 0.25 * Math.sqrt(r2);

      data[baseOffset] = nx;
      data[baseOffset + 1] = ny;
      data[baseOffset + 2] = nz;
      data[baseOffset + 3] = 1.0;

      // 10 expression blendshape residual bases B_1..B_10
      for (let b = 1; b <= 10; b++) {
        const basisOffset = baseOffset + b * 4;
        const freq = b * 0.5;
        data[basisOffset] = 0.02 * Math.sin(nx * Math.PI * freq);
        data[basisOffset + 1] = 0.02 * Math.cos(ny * Math.PI * freq);
        data[basisOffset + 2] = 0.01 * Math.sin((nx + ny) * Math.PI * freq);
        data[basisOffset + 3] = 0.0;
      }
    }
  }

  basesCache.set(targetSize, data);
  return data;
}

export async function isWebGPUFrontalizationSupported(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !(navigator as any).gpu) {
    return false;
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

/**
 * CPU reference implementation of Expression-Aware 3D UV Frontalization.
 * Computes 10-basis blendshape residual subtraction, 3D rotation, and bilinear texture sampling.
 */
export function runExpNormFrontalizationCPU(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas,
  bbox: SCRFDBoundingBox,
  pose: SCRFDPose,
  blendshapes?: Float32Array,
  targetSize: 112 | 160 = 112
): Float32Array {
  let origW = 640;
  let origH = 640;
  if ("naturalWidth" in source && source.naturalWidth) {
    origW = source.naturalWidth; origH = source.naturalHeight;
  } else if ("videoWidth" in source && source.videoWidth) {
    origW = source.videoWidth; origH = source.videoHeight;
  } else if ("width" in source && source.width) {
    origW = typeof source.width === "number" ? source.width : 640;
    origH = typeof source.height === "number" ? source.height : 640;
  }

  const canvas = createSafeCanvas(origW, origH);
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("[ExpNorm CPU] Context 2d failed");
  ctx.drawImage(source as any, 0, 0);
  const imgData = ctx.getImageData(0, 0, origW, origH);
  const rgba = imgData.data;


  const bases = getCanonicalBlendshapeBases(targetSize);
  const alphas = blendshapes || new Float32Array(10);

  const yawRad = (pose.yaw * Math.PI) / 180;
  const pitchRad = (pose.pitch * Math.PI) / 180;
  const rollRad = (pose.roll * Math.PI) / 180;

  const cy = Math.cos(yawRad); const sy = Math.sin(yawRad);
  const cp = Math.cos(pitchRad); const sp = Math.sin(pitchRad);
  const cr = Math.cos(rollRad); const sr = Math.sin(rollRad);

  // Rotation matrix components
  const r00 = cy * cr;
  const r01 = cy * sr;
  const r02 = -sy;
  const r10 = sp * sy * cr - cp * sr;
  const r11 = sp * sy * sr + cp * cr;
  const r12 = sp * cy;
  const r20 = cp * sy * cr + sp * sr;
  const r21 = cp * sy * sr - sp * cr;
  const r22 = cp * cy;

  const tensor = new Float32Array(1 * 3 * targetSize * targetSize);
  const planeSize = targetSize * targetSize;

  for (let v = 0; v < targetSize; v++) {
    for (let u = 0; u < targetSize; u++) {
      const pixelIdx = v * targetSize + u;
      const baseOffset = pixelIdx * 44;

      let x = bases[baseOffset];
      let y = bases[baseOffset + 1];
      let z = bases[baseOffset + 2];

      // Subtract 10-basis blendshape residual vectors
      for (let b = 0; b < 10; b++) {
        const alpha = alphas[b] || 0;
        const bOff = baseOffset + (b + 1) * 4;
        x -= alpha * bases[bOff];
        y -= alpha * bases[bOff + 1];
        z -= alpha * bases[bOff + 2];
      }

      // Rotate 3D vertex
      const rx = r00 * x + r10 * y + r20 * z;
      const ry = r01 * x + r11 * y + r21 * z;

      // Project onto source 2D image coordinates
      const srcX = (rx + 0.5) * bbox.width + bbox.x;
      const srcY = (ry + 0.5) * bbox.height + bbox.y;

      // Bilinear sample source RGB
      const x0 = Math.max(0, Math.min(origW - 1, Math.floor(srcX)));
      const x1 = Math.max(0, Math.min(origW - 1, Math.ceil(srcX)));
      const y0 = Math.max(0, Math.min(origH - 1, Math.floor(srcY)));
      const y1 = Math.max(0, Math.min(origH - 1, Math.ceil(srcY)));

      const dx = Math.max(0, Math.min(1, srcX - x0));
      const dy = Math.max(0, Math.min(1, srcY - y0));

      const idx00 = (y0 * origW + x0) * 4;
      const idx10 = (y0 * origW + x1) * 4;
      const idx01 = (y1 * origW + x0) * 4;
      const idx11 = (y1 * origW + x1) * 4;

      for (let c = 0; c < 3; c++) {
        const c00 = rgba[idx00 + c];
        const c10 = rgba[idx10 + c];
        const c01 = rgba[idx01 + c];
        const c11 = rgba[idx11 + c];

        const interp = (1 - dx) * (1 - dy) * c00 + dx * (1 - dy) * c10 + (1 - dx) * dy * c01 + dx * dy * c11;
        tensor[c * planeSize + pixelIdx] = (interp - 127.5) / 128.0;
      }
    }
  }

  return tensor;
}

/**
 * Executes Expression-Aware 3D UV WGSL compute shader for frontalization (|yaw| > 25°).
 * Falls back safely to 5-point Umeyama similarity transform if WebGPU is unavailable or encounters a runtime error.
 */
export async function runExpNormFrontalizationWGSL(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas,
  bbox: SCRFDBoundingBox,
  pose: SCRFDPose,
  landmarks?: Float32Array | number[][],
  blendshapes?: Float32Array,
  options: ExpNormOptions = {}
): Promise<Float32Array> {
  const outputSize = options.outputSize ?? 112;

  // Fail-fast fallback if WebGPU is not available in environment
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !(navigator as any).gpu) {
    if (landmarks) {
      return align5PointSimilarityTensor(source, landmarks, outputSize);
    }
    return runExpNormFrontalizationCPU(source, bbox, pose, blendshapes, outputSize);
  }

  try {
    const gpu = (navigator as any).gpu;
    const adapter = options.device ? null : await gpu.requestAdapter();
    const device: GPUDevice = options.device || (await adapter?.requestDevice());

    if (!device) {
      throw new Error("[ExpNorm WGSL] WebGPU GPUDevice unavailable");
    }

    // Determine original dimensions
    let origW = 640;
    let origH = 640;
    if ("naturalWidth" in source && source.naturalWidth) {
      origW = source.naturalWidth; origH = source.naturalHeight;
    } else if ("videoWidth" in source && source.videoWidth) {
      origW = source.videoWidth; origH = source.videoHeight;
    } else if ("width" in source && source.width) {
      origW = typeof source.width === "number" ? source.width : 640;
      origH = typeof source.height === "number" ? source.height : 640;
    }

    // Compile WGSL shader module
    const shaderModule = device.createShaderModule({
      code: EXP_NORM_WGSL_SHADER,
    });

    // Upload uniform buffer (128 bytes)
    const uniformArrayBuffer = new ArrayBuffer(128);
    const floatViews = new Float32Array(uniformArrayBuffer);
    const uintViews = new Uint32Array(uniformArrayBuffer);

    floatViews[0] = origW;
    floatViews[1] = origH;
    uintViews[2] = outputSize;
    uintViews[3] = outputSize;
    floatViews[4] = (pose.yaw * Math.PI) / 180;
    floatViews[5] = (pose.pitch * Math.PI) / 180;
    floatViews[6] = (pose.roll * Math.PI) / 180;
    floatViews[7] = bbox.x;
    floatViews[8] = bbox.y;
    floatViews[9] = bbox.width;
    floatViews[10] = bbox.height;
    floatViews[11] = 0.0; // pad

    const alphas = blendshapes || new Float32Array(10);
    for (let i = 0; i < 10; i++) {
      floatViews[12 + i] = alphas[i] || 0.0;
    }

    const uniformBuffer = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArrayBuffer);

    // Create & upload source texture
    const srcTexture = device.createTexture({
      size: [origW, origH, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture({ source: source as any }, { texture: srcTexture }, [origW, origH]);

    const textureSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    // Upload blendshape bases storage buffer
    const basesData = getCanonicalBlendshapeBases(outputSize);
    const blendshapeBuffer = device.createBuffer({
      size: basesData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(blendshapeBuffer, 0, basesData.buffer as ArrayBuffer);


    // Create output storage buffer & staging readback buffer
    const outputByteLength = 1 * 3 * outputSize * outputSize * 4;
    const outputStorageBuffer = device.createBuffer({
      size: outputByteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const stagingBuffer = device.createBuffer({
      size: outputByteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create compute pipeline & bind group
    const computePipeline = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    });

    const bindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: srcTexture.createView() },
        { binding: 2, resource: textureSampler },
        { binding: 3, resource: { buffer: blendshapeBuffer } },
        { binding: 4, resource: { buffer: outputStorageBuffer } },
      ],
    });

    // Command encoding & dispatch
    const commandEncoder = device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(outputSize / 16), Math.ceil(outputSize / 16), 1);
    pass.end();

    commandEncoder.copyBufferToBuffer(outputStorageBuffer, 0, stagingBuffer, 0, outputByteLength);
    device.queue.submit([commandEncoder.finish()]);

    // Readback mapped buffer
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const copyArrayBuffer = stagingBuffer.getMappedRange();
    const outputTensor = new Float32Array(copyArrayBuffer.slice(0));
    stagingBuffer.unmap();

    return outputTensor;
  } catch (webgpuErr) {
    console.warn("[ExpNorm WGSL] WebGPU compute execution failed; executing fail-safe similarity fallback:", webgpuErr);
    if (landmarks) {
      return align5PointSimilarityTensor(source, landmarks, outputSize);
    }
    return runExpNormFrontalizationCPU(source, bbox, pose, blendshapes, outputSize);
  }
}
