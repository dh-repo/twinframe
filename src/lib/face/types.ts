/** Normalized facial feature vector used for matching (0–1 scale unless noted). */
export interface FaceFeatures {
  faceAspect: number;
  jawWidth: number;
  chinSharpness: number;
  foreheadHeight: number;
  eyeSpacing: number;
  eyeOpenness: number;
  eyeSlant: number;
  browHeight: number;
  noseLength: number;
  noseWidth: number;
  mouthWidth: number;
  lipFullness: number;
  cheekboneProminence: number;
  faceRoundness: number;
  skinL: number;
  skinA: number;
  skinB: number;
  hairL: number;
  hairA: number;
  hairB: number;
  masculine: number;
  feminine: number;
  youthfulness: number;
}

export type FeatureKey = keyof FaceFeatures;

export const FEATURE_KEYS: FeatureKey[] = [
  "faceAspect",
  "jawWidth",
  "chinSharpness",
  "foreheadHeight",
  "eyeSpacing",
  "eyeOpenness",
  "eyeSlant",
  "browHeight",
  "noseLength",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "cheekboneProminence",
  "faceRoundness",
  "skinL",
  "skinA",
  "skinB",
  "hairL",
  "hairA",
  "hairB",
  "masculine",
  "feminine",
  "youthfulness",
];

export const FEATURE_WEIGHTS: Record<FeatureKey, number> = {
  faceAspect: 1.4,
  jawWidth: 1.5,
  chinSharpness: 1.1,
  foreheadHeight: 0.9,
  eyeSpacing: 1.3,
  eyeOpenness: 0.8,
  eyeSlant: 1.2,
  browHeight: 0.7,
  noseLength: 1.2,
  noseWidth: 1.1,
  mouthWidth: 1.0,
  lipFullness: 1.0,
  cheekboneProminence: 1.3,
  faceRoundness: 1.2,
  skinL: 1.6,
  skinA: 1.4,
  skinB: 1.4,
  hairL: 0.9,
  hairA: 0.7,
  hairB: 0.7,
  masculine: 1.8,
  feminine: 1.8,
  youthfulness: 1.0,
};

export interface FaceQuality {
  ok: boolean;
  score: number;
  faceCoverage: number;
  centered: number;
  sharpness: number;
  illumination: number;
  issues: string[];
}

export interface TraitInsight {
  trait: string;
  userValue: number;
  celebValue: number;
  similarity: number;
  label: string;
}

export type EthnicCluster =
  | "East Asian"
  | "South Asian"
  | "African"
  | "Caucasian"
  | "Hispanic"
  | "Middle Eastern";

export const ETHNIC_CLUSTERS: EthnicCluster[] = [
  "East Asian",
  "South Asian",
  "African",
  "Caucasian",
  "Hispanic",
  "Middle Eastern",
];

export interface CelebrityMatch {
  celebrityId: string;
  name: string;
  knownFor: string;
  matchPercent: number;
  rawScore: number;
  confidenceScore?: number;
  traits: TraitInsight[];
  accentHue: number;
  initials: string;
  tags: string[];
  photoUrl?: string;
  photoUrl192?: string;
  fallbackPhotoUrl?: string;
  distance?: number;
  ethnicCluster?: EthnicCluster;
}

/**
 * Detailed breakdown of face processing stage execution latencies in milliseconds.
 */
export interface FaceStageLatencies {
  /** Time spent loading/fetching TF.js neural network models */
  modelLoadMs: number;
  /** Time spent downscaling input image to detection canvas */
  downscaleMs: number;
  /** Time spent on SSD MobileNet face detection pass */
  ssdPassMs: number;
  /** Time spent on CLAHE local contrast boost adjustment pass (0 if skipped) */
  claheMs: number;
  /** Time spent on 128-d FaceNet descriptor embedding extraction */
  embeddingMs: number;
  /** Total wall-clock execution latency for full face analysis */
  totalMs: number;
}

/**
 * Diagnostic telemetry data recorded during face detection and analysis.
 */
export interface FaceTelemetry {
  /** Original image source width in pixels */
  originalWidth: number;
  /** Original image source height in pixels */
  originalHeight: number;
  /** Downscaled detection canvas width in pixels */
  downscaledWidth: number;
  /** Downscaled detection canvas height in pixels */
  downscaledHeight: number;
  /** Number of face candidates detected in original image */
  faceCount: number;
  /** SSD MobileNet detector confidence score for primary selected face [0.0..1.0] */
  primaryConfidence: number;
  /** Breakdown of stage latencies */
  latencies: FaceStageLatencies;
}

export interface MatchResult {
  features: FaceFeatures | null;
  quality: FaceQuality;
  matches: CelebrityMatch[];
  analyzedAt: number;
  engineVersion: string;
  facePreviewUrl?: string;
  estimatedAge?: number;
  estimatedGender?: string;
  telemetry?: FaceTelemetry;
  candidates?: import("./faceapi-engine").FaceCandidate[];
  candidateBoxes?: Array<{ x: number; y: number; width: number; height: number; isPrimary: boolean }>;
}

export const ENGINE_VERSION = "3.2.0-dlib-align";

export type FaceViewType =
  | "frontal"
  | "profile_left"
  | "profile_right"
  | "angled_30"
  | "expression";

export interface HeadPoseOrientation {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface ReferenceVector {
  /** 128-dimensional L2-normalized FaceNet embedding vector */
  descriptor: Float32Array;
  /** Categorical head view orientation / expression category */
  viewType?: FaceViewType;
  /** 3D head pose angles in degrees */
  pose?: HeadPoseOrientation;
  /** Direct URL or relative path to the source reference photo crop */
  photoUrl?: string;
  /** 23-dimensional normalized facial structural features specific to this view */
  features?: FaceFeatures;
  /** Ethnic cluster annotation for cross-demographic alignment */
  ethnicCluster?: EthnicCluster;
}

export interface CelebrityEmbedding {
  id: string;
  path: string;
  name: string;
  descriptor: number[];
  descriptors?: Float32Array[];
  referenceVectors?: ReferenceVector[];
  age: number;
  gender: "male" | "female";
  genderProb: number;
  features?: FaceFeatures;
  bucketAge?: number;
  fallbackPath?: string;
  path192?: string;
  ethnicCluster?: EthnicCluster;
}

export const DEMOGRAPHIC_CLUSTER_MAP: Record<string, EthnicCluster> = {
  // East Asian
  "simu-liu": "East Asian",
  "john-cho": "East Asian",
  "gong-li": "East Asian",
  "liu-yifei": "East Asian",
  "ali-wong": "East Asian",
  "ke-huy-quan": "East Asian",
  "hayao-miyazaki": "East Asian",
  "awkwafina": "East Asian",
  "sandra-oh": "East Asian",
  "jisoo": "East Asian",
  "jackie-chan": "East Asian",
  "ken-watanabe": "East Asian",
  "steven-yeun": "East Asian",
  "bruce-lee": "East Asian",
  "gemma-chan": "East Asian",
  "bowen-yang": "East Asian",
  "jamie-chung": "East Asian",
  "daniel-dae-kim": "East Asian",
  "byung-hun-lee": "East Asian",
  "donnie-yen": "East Asian",
  "michelle-yeoh": "East Asian",
  "ludi-lin": "East Asian",
  "rain": "East Asian",
  "son-heung-min": "East Asian",

  // South Asian
  "dev-patel": "South Asian",
  "priyanka-chopra": "South Asian",
  "priyanka-chopra-jonas": "South Asian",
  "riz-ahmed": "South Asian",
  "alia-bhatt": "South Asian",
  "aishwarya-rai": "South Asian",
  "maitreyi-ramakrishnan": "South Asian",
  "shah-rukh-khan": "South Asian",
  "deepika-padukone": "South Asian",
  "mindy-kaling": "South Asian",
  "kumail-nanjiani": "South Asian",
  "hassan-minhaj": "South Asian",
  "sendhil-ramamurthy": "South Asian",
  "kunam-nayyar": "South Asian",
  "anupam-kher": "South Asian",
  "irrfan-khan": "South Asian",

  // African
  "denzel-washington": "African",
  "idris-elba": "African",
  "michael-b-jordan": "African",
  "mahershala-ali": "African",
  "lupita-nyongo": "African",
  "viola-davis": "African",
  "yara-shahidi": "African",
  "uzo-aduba": "African",
  "daniel-kaluuya": "African",
  "john-boyega": "African",
  "beyonce": "African",
  "rihanna": "African",
  "donald-glover": "African",
  "serena-williams": "African",
  "sterling-k-brown": "African",
  "colman-domingo": "African",
  "lebron-james": "African",
  "aisha-hinds": "African",
  "halle-bailey": "African",
  "kendrick-lamar": "African",
  "chadwick-boseman": "African",
  "morgan-freeman": "African",
  "samuel-l-jackson": "African",
  "will-smith": "African",
  "eddie-murphy": "African",
  "forest-whitaker": "African",
  "winston-duke": "African",
  "laurence-fishburne": "African",
  "terrence-howard": "African",
  "regina-king": "African",
  "octavia-spencer": "African",
  "taraji-p-henson": "African",
  "kerry-washington": "African",
  "zoe-kravitz": "African",
  "janelle-monae": "African",
  "keke-palmer": "African",
  "naomi-campbell": "African",

  // Caucasian
  "brad-pitt": "Caucasian",
  "george-clooney": "Caucasian",
  "ryan-gosling": "Caucasian",
  "timothee-chalamet": "Caucasian",
  "tom-holland": "Caucasian",
  "chris-hemsworth": "Caucasian",
  "scarlett-johansson": "Caucasian",
  "margot-robbie": "Caucasian",
  "emma-stone": "Caucasian",
  "florence-pugh": "Caucasian",
  "jennifer-lawrence": "Caucasian",
  "sydney-sweeney": "Caucasian",
  "chris-evans": "Caucasian",
  "andrew-garfield": "Caucasian",
  "elizabeth-olsen": "Caucasian",
  "keanu-reeves": "Caucasian",
  "adam-driver": "Caucasian",
  "jacob-elordi": "Caucasian",
  "millie-bobby-brown": "Caucasian",
  "gwyneth-paltrow": "Caucasian",
  "gwenyth-paltrow": "Caucasian",
  "dakota-johnson": "Caucasian",
  "cara-delevingne": "Caucasian",
  "leonardo-dicaprio": "Caucasian",
  "matt-damon": "Caucasian",
  "ben-affleck": "Caucasian",
  "christian-bale": "Caucasian",
  "tom-cruise": "Caucasian",
  "charlize-theron": "Caucasian",
  "cate-blanchett": "Caucasian",
  "nicole-kidman": "Caucasian",
  "anne-hathaway": "Caucasian",
  "jessica-chastain": "Caucasian",
  "keira-knightley": "Caucasian",
  "emily-blunt": "Caucasian",
  "rachel-mcadams": "Caucasian",
  "angelina-jolie": "Caucasian",
  "natalie-portman": "Caucasian",
  "lily-gladstone": "Caucasian",

  // Hispanic
  "pedro-pascal": "Hispanic",
  "salma-hayek": "Hispanic",
  "bad-bunny": "Hispanic",
  "ana-de-armas": "Hispanic",
  "jenna-ortega": "Hispanic",
  "camila-cabello": "Hispanic",
  "diego-luna": "Hispanic",
  "oscar-isaac": "Hispanic",
  "karol-g": "Hispanic",
  "penelope-cruz": "Hispanic",
  "antonio-banderas": "Hispanic",
  "javier-bardem": "Hispanic",
  "gael-garcia-bernal": "Hispanic",
  "rosario-dawson": "Hispanic",
  "america-ferrera": "Hispanic",
  "eva-longoria": "Hispanic",
  "jennifer-lopez": "Hispanic",
  "danny-trejo": "Hispanic",
  "zoe-saldana": "Hispanic",
  "michelle-rodriguez": "Hispanic",
  "eiza-gonzalez": "Hispanic",
  "stephanie-beatriz": "Hispanic",
  "anthony-ramos": "Hispanic",

  // Middle Eastern
  "rami-malek": "Middle Eastern",
  "gal-gadot": "Middle Eastern",
  "golshifteh-farahani": "Middle Eastern",
  "tahar-rahim": "Middle Eastern",
  "shohreh-aghdashloo": "Middle Eastern",
  "mena-massoud": "Middle Eastern",
  "nassim-pedrad": "Middle Eastern",
  "haaz-sleiman": "Middle Eastern",
  "may-calamawy": "Middle Eastern",
  "ali-fazal": "Middle Eastern",
};

export function getEthnicCluster(celeb: {
  id: string;
  name?: string;
  features?: FaceFeatures | null;
  ethnicCluster?: EthnicCluster;
}): EthnicCluster {
  if (celeb.ethnicCluster) return celeb.ethnicCluster;
  const canonId = celeb.id.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (DEMOGRAPHIC_CLUSTER_MAP[canonId]) {
    return DEMOGRAPHIC_CLUSTER_MAP[canonId]!;
  }
  const baseId = canonId.replace(/-\d+$/, "");
  if (DEMOGRAPHIC_CLUSTER_MAP[baseId]) {
    return DEMOGRAPHIC_CLUSTER_MAP[baseId]!;
  }
  for (const [key, cluster] of Object.entries(DEMOGRAPHIC_CLUSTER_MAP)) {
    if (baseId === key || baseId.startsWith(key) || key.startsWith(baseId)) {
      return cluster;
    }
  }
  const feat = celeb.features;
  if (feat) {
    if (feat.eyeSlant > 0.58 && feat.cheekboneProminence > 0.62) return "East Asian";
    if (feat.skinL < 0.40) return "African";
    if (feat.skinL > 0.72) return "Caucasian";
    if (feat.skinB > 0.56 && feat.skinL >= 0.40 && feat.skinL <= 0.68) return "Hispanic";
  }
  return "Caucasian";
}



