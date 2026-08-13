import type { FaceFeatures } from "../face/types.ts";
import { mergeFeatures } from "../face/math.ts";
import type { CelebrityProfile } from "./types.ts";

function c(
  id: string,
  name: string,
  knownFor: string,
  tags: string[],
  accentHue: number,
  partial: Partial<FaceFeatures>,
): CelebrityProfile {
  return {
    id,
    name,
    knownFor,
    tags,
    accentHue,
    features: mergeFeatures(partial),
  };
}

/**
 * Curated celebrity gallery with hand-tuned facial feature priors.
 *
 * These are stylized geometric / appearance targets (not biometric IDs).
 * Matching compares user-extracted MediaPipe landmark ratios + color samples
 * against this gallery via weighted ensemble similarity.
 *
 * Expand this list and re-run the test suite to improve coverage over time.
 */
export const CELEBRITIES: CelebrityProfile[] = [
  c("brad-pitt", "Brad Pitt", "Actor", ["angular", "blond", "strong jaw"], 42, {
    faceAspect: 0.62, jawWidth: 0.72, chinSharpness: 0.7, foreheadHeight: 0.55,
    eyeSpacing: 0.52, eyeOpenness: 0.48, eyeSlant: 0.48, browHeight: 0.55,
    noseLength: 0.58, noseWidth: 0.48, mouthWidth: 0.52, lipFullness: 0.42,
    cheekboneProminence: 0.72, faceRoundness: 0.38,
    skinL: 0.72, skinA: 0.52, skinB: 0.56, hairL: 0.62, hairA: 0.5, hairB: 0.58,
    masculine: 0.78, feminine: 0.28, youthfulness: 0.48,
  }),
  c("george-clooney", "George Clooney", "Actor", ["silver hair", "classic"], 210, {
    faceAspect: 0.6, jawWidth: 0.7, chinSharpness: 0.62, foreheadHeight: 0.62,
    eyeSpacing: 0.55, eyeOpenness: 0.5, eyeSlant: 0.5, browHeight: 0.52,
    noseLength: 0.55, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.4,
    cheekboneProminence: 0.65, faceRoundness: 0.42,
    skinL: 0.7, skinA: 0.52, skinB: 0.55, hairL: 0.55, hairA: 0.48, hairB: 0.5,
    masculine: 0.8, feminine: 0.25, youthfulness: 0.35,
  }),
  c("denzel-washington", "Denzel Washington", "Actor", ["intense eyes", "classic"], 28, {
    faceAspect: 0.58, jawWidth: 0.68, chinSharpness: 0.55, foreheadHeight: 0.58,
    eyeSpacing: 0.54, eyeOpenness: 0.55, eyeSlant: 0.5, browHeight: 0.58,
    noseLength: 0.55, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.62, faceRoundness: 0.48,
    skinL: 0.38, skinA: 0.55, skinB: 0.55, hairL: 0.25, hairA: 0.5, hairB: 0.48,
    masculine: 0.82, feminine: 0.22, youthfulness: 0.38,
  }),
  c("idris-elba", "Idris Elba", "Actor", ["broad jaw", "deep-set eyes"], 18, {
    faceAspect: 0.64, jawWidth: 0.78, chinSharpness: 0.6, foreheadHeight: 0.5,
    eyeSpacing: 0.52, eyeOpenness: 0.45, eyeSlant: 0.48, browHeight: 0.6,
    noseLength: 0.58, noseWidth: 0.58, mouthWidth: 0.58, lipFullness: 0.52,
    cheekboneProminence: 0.7, faceRoundness: 0.45,
    skinL: 0.32, skinA: 0.54, skinB: 0.54, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.88, feminine: 0.18, youthfulness: 0.42,
  }),
  c("ryan-gosling", "Ryan Gosling", "Actor", ["soft jaw", "cool tone"], 200, {
    faceAspect: 0.58, jawWidth: 0.58, chinSharpness: 0.55, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.58, eyeSlant: 0.52, browHeight: 0.48,
    noseLength: 0.52, noseWidth: 0.45, mouthWidth: 0.5, lipFullness: 0.48,
    cheekboneProminence: 0.6, faceRoundness: 0.5,
    skinL: 0.74, skinA: 0.52, skinB: 0.54, hairL: 0.35, hairA: 0.5, hairB: 0.5,
    masculine: 0.65, feminine: 0.4, youthfulness: 0.55,
  }),
  c("timothee-chalamet", "Timothée Chalamet", "Actor", ["angular", "youthful"], 25, {
    faceAspect: 0.52, jawWidth: 0.48, chinSharpness: 0.75, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.62, eyeSlant: 0.52, browHeight: 0.5,
    noseLength: 0.55, noseWidth: 0.42, mouthWidth: 0.48, lipFullness: 0.55,
    cheekboneProminence: 0.75, faceRoundness: 0.35,
    skinL: 0.76, skinA: 0.52, skinB: 0.55, hairL: 0.3, hairA: 0.5, hairB: 0.5,
    masculine: 0.48, feminine: 0.55, youthfulness: 0.78,
  }),
  c("tom-holland", "Tom Holland", "Actor", ["boyish", "rounder face"], 12, {
    faceAspect: 0.6, jawWidth: 0.55, chinSharpness: 0.5, foreheadHeight: 0.5,
    eyeSpacing: 0.54, eyeOpenness: 0.6, eyeSlant: 0.5, browHeight: 0.45,
    noseLength: 0.48, noseWidth: 0.48, mouthWidth: 0.52, lipFullness: 0.5,
    cheekboneProminence: 0.55, faceRoundness: 0.65,
    skinL: 0.73, skinA: 0.53, skinB: 0.56, hairL: 0.32, hairA: 0.5, hairB: 0.5,
    masculine: 0.55, feminine: 0.45, youthfulness: 0.8,
  }),
  c("michael-b-jordan", "Michael B. Jordan", "Actor", ["defined jaw", "full lips"], 8, {
    faceAspect: 0.6, jawWidth: 0.74, chinSharpness: 0.72, foreheadHeight: 0.5,
    eyeSpacing: 0.53, eyeOpenness: 0.52, eyeSlant: 0.5, browHeight: 0.55,
    noseLength: 0.52, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.65,
    cheekboneProminence: 0.68, faceRoundness: 0.42,
    skinL: 0.35, skinA: 0.55, skinB: 0.55, hairL: 0.18, hairA: 0.5, hairB: 0.48,
    masculine: 0.85, feminine: 0.22, youthfulness: 0.55,
  }),
  c("chris-hemsworth", "Chris Hemsworth", "Actor", ["square jaw", "broad face"], 38, {
    faceAspect: 0.68, jawWidth: 0.82, chinSharpness: 0.65, foreheadHeight: 0.48,
    eyeSpacing: 0.5, eyeOpenness: 0.5, eyeSlant: 0.48, browHeight: 0.55,
    noseLength: 0.55, noseWidth: 0.52, mouthWidth: 0.55, lipFullness: 0.45,
    cheekboneProminence: 0.7, faceRoundness: 0.48,
    skinL: 0.72, skinA: 0.53, skinB: 0.58, hairL: 0.45, hairA: 0.52, hairB: 0.58,
    masculine: 0.9, feminine: 0.15, youthfulness: 0.5,
  }),
  c("keanu-reeves", "Keanu Reeves", "Actor", ["long face", "soft features"], 220, {
    faceAspect: 0.52, jawWidth: 0.55, chinSharpness: 0.58, foreheadHeight: 0.6,
    eyeSpacing: 0.56, eyeOpenness: 0.55, eyeSlant: 0.48, browHeight: 0.5,
    noseLength: 0.58, noseWidth: 0.48, mouthWidth: 0.5, lipFullness: 0.42,
    cheekboneProminence: 0.58, faceRoundness: 0.4,
    skinL: 0.7, skinA: 0.52, skinB: 0.54, hairL: 0.22, hairA: 0.5, hairB: 0.48,
    masculine: 0.7, feminine: 0.35, youthfulness: 0.5,
  }),
  c("pedro-pascal", "Pedro Pascal", "Actor", ["warm eyes", "expressive"], 22, {
    faceAspect: 0.58, jawWidth: 0.6, chinSharpness: 0.5, foreheadHeight: 0.55,
    eyeSpacing: 0.54, eyeOpenness: 0.58, eyeSlant: 0.5, browHeight: 0.52,
    noseLength: 0.55, noseWidth: 0.55, mouthWidth: 0.58, lipFullness: 0.55,
    cheekboneProminence: 0.6, faceRoundness: 0.52,
    skinL: 0.58, skinA: 0.56, skinB: 0.58, hairL: 0.28, hairA: 0.5, hairB: 0.5,
    masculine: 0.68, feminine: 0.38, youthfulness: 0.48,
  }),
  c("henry-cavill", "Henry Cavill", "Actor", ["square jaw", "classic hero"], 205, {
    faceAspect: 0.62, jawWidth: 0.8, chinSharpness: 0.7, foreheadHeight: 0.5,
    eyeSpacing: 0.52, eyeOpenness: 0.48, eyeSlant: 0.48, browHeight: 0.55,
    noseLength: 0.55, noseWidth: 0.5, mouthWidth: 0.52, lipFullness: 0.42,
    cheekboneProminence: 0.68, faceRoundness: 0.4,
    skinL: 0.72, skinA: 0.52, skinB: 0.55, hairL: 0.3, hairA: 0.5, hairB: 0.5,
    masculine: 0.88, feminine: 0.18, youthfulness: 0.45,
  }),
  c("dev-patel", "Dev Patel", "Actor", ["expressive eyes", "angular"], 30, {
    faceAspect: 0.55, jawWidth: 0.55, chinSharpness: 0.65, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.62, eyeSlant: 0.52, browHeight: 0.55,
    noseLength: 0.58, noseWidth: 0.52, mouthWidth: 0.52, lipFullness: 0.5,
    cheekboneProminence: 0.7, faceRoundness: 0.4,
    skinL: 0.48, skinA: 0.56, skinB: 0.6, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.62, feminine: 0.42, youthfulness: 0.58,
  }),
  c("simu-liu", "Simu Liu", "Actor", ["sharp jaw", "bright eyes"], 5, {
    faceAspect: 0.58, jawWidth: 0.68, chinSharpness: 0.72, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.58, browHeight: 0.5,
    noseLength: 0.5, noseWidth: 0.48, mouthWidth: 0.52, lipFullness: 0.48,
    cheekboneProminence: 0.72, faceRoundness: 0.42,
    skinL: 0.62, skinA: 0.54, skinB: 0.56, hairL: 0.18, hairA: 0.5, hairB: 0.48,
    masculine: 0.75, feminine: 0.3, youthfulness: 0.55,
  }),
  c("oscar-isaac", "Oscar Isaac", "Actor", ["strong brow", "warm tone"], 15, {
    faceAspect: 0.58, jawWidth: 0.65, chinSharpness: 0.58, foreheadHeight: 0.55,
    eyeSpacing: 0.53, eyeOpenness: 0.52, eyeSlant: 0.5, browHeight: 0.6,
    noseLength: 0.55, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.5,
    cheekboneProminence: 0.62, faceRoundness: 0.48,
    skinL: 0.55, skinA: 0.56, skinB: 0.58, hairL: 0.22, hairA: 0.5, hairB: 0.5,
    masculine: 0.78, feminine: 0.28, youthfulness: 0.48,
  }),
  c("john-cho", "John Cho", "Actor", ["kind eyes", "balanced"], 190, {
    faceAspect: 0.58, jawWidth: 0.58, chinSharpness: 0.55, foreheadHeight: 0.55,
    eyeSpacing: 0.56, eyeOpenness: 0.55, eyeSlant: 0.55, browHeight: 0.5,
    noseLength: 0.5, noseWidth: 0.48, mouthWidth: 0.52, lipFullness: 0.48,
    cheekboneProminence: 0.62, faceRoundness: 0.5,
    skinL: 0.6, skinA: 0.54, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.68, feminine: 0.35, youthfulness: 0.5,
  }),
  c("adam-driver", "Adam Driver", "Actor", ["long face", "strong brow"], 0, {
    faceAspect: 0.48, jawWidth: 0.6, chinSharpness: 0.55, foreheadHeight: 0.65,
    eyeSpacing: 0.55, eyeOpenness: 0.48, eyeSlant: 0.48, browHeight: 0.62,
    noseLength: 0.65, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.4,
    cheekboneProminence: 0.55, faceRoundness: 0.32,
    skinL: 0.72, skinA: 0.52, skinB: 0.54, hairL: 0.25, hairA: 0.5, hairB: 0.5,
    masculine: 0.8, feminine: 0.25, youthfulness: 0.4,
  }),
  c("donald-glover", "Donald Glover", "Artist", ["expressive", "soft jaw"], 320, {
    faceAspect: 0.58, jawWidth: 0.55, chinSharpness: 0.52, foreheadHeight: 0.55,
    eyeSpacing: 0.55, eyeOpenness: 0.58, eyeSlant: 0.5, browHeight: 0.5,
    noseLength: 0.52, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.36, skinA: 0.55, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.62, feminine: 0.42, youthfulness: 0.55,
  }),
  c("riz-ahmed", "Riz Ahmed", "Actor", ["intense gaze", "compact features"], 35, {
    faceAspect: 0.58, jawWidth: 0.6, chinSharpness: 0.6, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.5, browHeight: 0.58,
    noseLength: 0.55, noseWidth: 0.55, mouthWidth: 0.52, lipFullness: 0.5,
    cheekboneProminence: 0.65, faceRoundness: 0.48,
    skinL: 0.5, skinA: 0.56, skinB: 0.6, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.7, feminine: 0.35, youthfulness: 0.52,
  }),
  c("mahershala-ali", "Mahershala Ali", "Actor", ["regal bone structure"], 240, {
    faceAspect: 0.58, jawWidth: 0.7, chinSharpness: 0.65, foreheadHeight: 0.55,
    eyeSpacing: 0.54, eyeOpenness: 0.5, eyeSlant: 0.5, browHeight: 0.55,
    noseLength: 0.55, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.52,
    cheekboneProminence: 0.72, faceRoundness: 0.42,
    skinL: 0.3, skinA: 0.54, skinB: 0.54, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.85, feminine: 0.2, youthfulness: 0.4,
  }),
  c("zendaya", "Zendaya", "Actor", ["high cheekbones", "almond eyes"], 340, {
    faceAspect: 0.55, jawWidth: 0.5, chinSharpness: 0.7, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.58, eyeSlant: 0.55, browHeight: 0.52,
    noseLength: 0.5, noseWidth: 0.45, mouthWidth: 0.52, lipFullness: 0.6,
    cheekboneProminence: 0.8, faceRoundness: 0.4,
    skinL: 0.48, skinA: 0.56, skinB: 0.58, hairL: 0.28, hairA: 0.52, hairB: 0.55,
    masculine: 0.22, feminine: 0.85, youthfulness: 0.75,
  }),
  c("scarlett-johansson", "Scarlett Johansson", "Actor", ["full lips", "wide eyes"], 12, {
    faceAspect: 0.62, jawWidth: 0.55, chinSharpness: 0.45, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.62, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.45, noseWidth: 0.45, mouthWidth: 0.55, lipFullness: 0.78,
    cheekboneProminence: 0.6, faceRoundness: 0.58,
    skinL: 0.78, skinA: 0.53, skinB: 0.55, hairL: 0.55, hairA: 0.55, hairB: 0.58,
    masculine: 0.2, feminine: 0.88, youthfulness: 0.6,
  }),
  c("lupita-nyongo", "Lupita Nyong'o", "Actor", ["striking bone structure"], 30, {
    faceAspect: 0.55, jawWidth: 0.55, chinSharpness: 0.72, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.6, eyeSlant: 0.52, browHeight: 0.55,
    noseLength: 0.52, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.65,
    cheekboneProminence: 0.82, faceRoundness: 0.4,
    skinL: 0.28, skinA: 0.55, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.25, feminine: 0.82, youthfulness: 0.58,
  }),
  c("margot-robbie", "Margot Robbie", "Actor", ["classic oval", "bright"], 45, {
    faceAspect: 0.58, jawWidth: 0.52, chinSharpness: 0.55, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.58, eyeSlant: 0.5, browHeight: 0.5,
    noseLength: 0.48, noseWidth: 0.45, mouthWidth: 0.52, lipFullness: 0.58,
    cheekboneProminence: 0.65, faceRoundness: 0.5,
    skinL: 0.78, skinA: 0.53, skinB: 0.56, hairL: 0.65, hairA: 0.55, hairB: 0.6,
    masculine: 0.2, feminine: 0.88, youthfulness: 0.65,
  }),
  c("rihanna", "Rihanna", "Artist", ["full features", "almond eyes"], 350, {
    faceAspect: 0.58, jawWidth: 0.55, chinSharpness: 0.55, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.55, browHeight: 0.55,
    noseLength: 0.5, noseWidth: 0.55, mouthWidth: 0.58, lipFullness: 0.75,
    cheekboneProminence: 0.7, faceRoundness: 0.52,
    skinL: 0.4, skinA: 0.56, skinB: 0.58, hairL: 0.25, hairA: 0.5, hairB: 0.5,
    masculine: 0.22, feminine: 0.88, youthfulness: 0.6,
  }),
  c("emma-stone", "Emma Stone", "Actor", ["wide smile", "big eyes"], 8, {
    faceAspect: 0.58, jawWidth: 0.52, chinSharpness: 0.5, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.7, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.45, noseWidth: 0.45, mouthWidth: 0.6, lipFullness: 0.55,
    cheekboneProminence: 0.6, faceRoundness: 0.55,
    skinL: 0.78, skinA: 0.54, skinB: 0.56, hairL: 0.5, hairA: 0.58, hairB: 0.58,
    masculine: 0.2, feminine: 0.85, youthfulness: 0.62,
  }),
  c("florence-pugh", "Florence Pugh", "Actor", ["full cheeks", "bold brow"], 20, {
    faceAspect: 0.6, jawWidth: 0.55, chinSharpness: 0.48, foreheadHeight: 0.5,
    eyeSpacing: 0.54, eyeOpenness: 0.55, eyeSlant: 0.5, browHeight: 0.58,
    noseLength: 0.48, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.65,
    cheekboneProminence: 0.58, faceRoundness: 0.6,
    skinL: 0.76, skinA: 0.53, skinB: 0.55, hairL: 0.35, hairA: 0.52, hairB: 0.52,
    masculine: 0.25, feminine: 0.82, youthfulness: 0.6,
  }),
  c("awkwafina", "Awkwafina", "Actor", ["expressive", "unique bone structure"], 160, {
    faceAspect: 0.55, jawWidth: 0.55, chinSharpness: 0.65, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.55, eyeSlant: 0.58, browHeight: 0.52,
    noseLength: 0.5, noseWidth: 0.48, mouthWidth: 0.58, lipFullness: 0.5,
    cheekboneProminence: 0.7, faceRoundness: 0.45,
    skinL: 0.62, skinA: 0.54, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.35, feminine: 0.7, youthfulness: 0.55,
  }),
  c("ana-de-armas", "Ana de Armas", "Actor", ["almond eyes", "soft oval"], 350, {
    faceAspect: 0.55, jawWidth: 0.5, chinSharpness: 0.6, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.6, eyeSlant: 0.55, browHeight: 0.5,
    noseLength: 0.48, noseWidth: 0.42, mouthWidth: 0.5, lipFullness: 0.6,
    cheekboneProminence: 0.72, faceRoundness: 0.48,
    skinL: 0.74, skinA: 0.54, skinB: 0.56, hairL: 0.35, hairA: 0.52, hairB: 0.52,
    masculine: 0.18, feminine: 0.9, youthfulness: 0.68,
  }),
  c("sydney-sweeney", "Sydney Sweeney", "Actor", ["big eyes", "full lips"], 5, {
    faceAspect: 0.58, jawWidth: 0.5, chinSharpness: 0.5, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.72, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.45, noseWidth: 0.45, mouthWidth: 0.55, lipFullness: 0.72,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.8, skinA: 0.53, skinB: 0.55, hairL: 0.55, hairA: 0.54, hairB: 0.58,
    masculine: 0.18, feminine: 0.9, youthfulness: 0.72,
  }),
  c("viola-davis", "Viola Davis", "Actor", ["commanding presence", "warm"], 25, {
    faceAspect: 0.58, jawWidth: 0.6, chinSharpness: 0.55, foreheadHeight: 0.55,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.5, browHeight: 0.55,
    noseLength: 0.52, noseWidth: 0.55, mouthWidth: 0.58, lipFullness: 0.6,
    cheekboneProminence: 0.65, faceRoundness: 0.5,
    skinL: 0.35, skinA: 0.55, skinB: 0.55, hairL: 0.22, hairA: 0.5, hairB: 0.48,
    masculine: 0.3, feminine: 0.78, youthfulness: 0.4,
  }),
  c("salma-hayek", "Salma Hayek", "Actor", ["full lips", "arched brows"], 15, {
    faceAspect: 0.58, jawWidth: 0.52, chinSharpness: 0.55, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.58, eyeSlant: 0.52, browHeight: 0.58,
    noseLength: 0.5, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.78,
    cheekboneProminence: 0.7, faceRoundness: 0.5,
    skinL: 0.58, skinA: 0.56, skinB: 0.6, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.2, feminine: 0.9, youthfulness: 0.55,
  }),
  c("gong-li", "Gong Li", "Actor", ["sculpted cheekbones", "almond eyes"], 0, {
    faceAspect: 0.55, jawWidth: 0.52, chinSharpness: 0.68, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.55, eyeSlant: 0.6, browHeight: 0.55,
    noseLength: 0.5, noseWidth: 0.45, mouthWidth: 0.5, lipFullness: 0.55,
    cheekboneProminence: 0.85, faceRoundness: 0.38,
    skinL: 0.65, skinA: 0.54, skinB: 0.55, hairL: 0.18, hairA: 0.5, hairB: 0.48,
    masculine: 0.22, feminine: 0.85, youthfulness: 0.5,
  }),
  c("priyanka-chopra", "Priyanka Chopra Jonas", "Actor", ["striking eyes", "defined"], 320, {
    faceAspect: 0.55, jawWidth: 0.55, chinSharpness: 0.65, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.6, eyeSlant: 0.52, browHeight: 0.55,
    noseLength: 0.52, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.62,
    cheekboneProminence: 0.75, faceRoundness: 0.45,
    skinL: 0.5, skinA: 0.56, skinB: 0.6, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.22, feminine: 0.88, youthfulness: 0.55,
  }),
  c("jennifer-lawrence", "Jennifer Lawrence", "Actor", ["wide smile", "soft oval"], 35, {
    faceAspect: 0.6, jawWidth: 0.55, chinSharpness: 0.5, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.58, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.48, noseWidth: 0.48, mouthWidth: 0.6, lipFullness: 0.55,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.76, skinA: 0.53, skinB: 0.55, hairL: 0.5, hairA: 0.55, hairB: 0.58,
    masculine: 0.25, feminine: 0.82, youthfulness: 0.58,
  }),
  c("yara-shahidi", "Yara Shahidi", "Actor", ["bright eyes", "youthful"], 280, {
    faceAspect: 0.58, jawWidth: 0.5, chinSharpness: 0.55, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.65, eyeSlant: 0.52, browHeight: 0.5,
    noseLength: 0.48, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.6,
    cheekboneProminence: 0.65, faceRoundness: 0.55,
    skinL: 0.42, skinA: 0.55, skinB: 0.56, hairL: 0.22, hairA: 0.5, hairB: 0.48,
    masculine: 0.2, feminine: 0.85, youthfulness: 0.8,
  }),
  c("uzo-aduba", "Uzo Aduba", "Actor", ["radiant smile", "round features"], 40, {
    faceAspect: 0.62, jawWidth: 0.55, chinSharpness: 0.45, foreheadHeight: 0.5,
    eyeSpacing: 0.54, eyeOpenness: 0.6, eyeSlant: 0.5, browHeight: 0.5,
    noseLength: 0.5, noseWidth: 0.55, mouthWidth: 0.62, lipFullness: 0.65,
    cheekboneProminence: 0.55, faceRoundness: 0.7,
    skinL: 0.35, skinA: 0.55, skinB: 0.55, hairL: 0.25, hairA: 0.5, hairB: 0.48,
    masculine: 0.25, feminine: 0.8, youthfulness: 0.5,
  }),
  c("liu-yifei", "Liu Yifei", "Actor", ["delicate features", "almond eyes"], 350, {
    faceAspect: 0.52, jawWidth: 0.45, chinSharpness: 0.7, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.58, eyeSlant: 0.6, browHeight: 0.5,
    noseLength: 0.48, noseWidth: 0.4, mouthWidth: 0.48, lipFullness: 0.55,
    cheekboneProminence: 0.75, faceRoundness: 0.42,
    skinL: 0.72, skinA: 0.53, skinB: 0.54, hairL: 0.18, hairA: 0.5, hairB: 0.48,
    masculine: 0.15, feminine: 0.92, youthfulness: 0.7,
  }),
  c("gal-gadot", "Gal Gadot", "Actor", ["strong brow", "sculpted"], 200, {
    faceAspect: 0.55, jawWidth: 0.58, chinSharpness: 0.68, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.52, browHeight: 0.58,
    noseLength: 0.52, noseWidth: 0.45, mouthWidth: 0.52, lipFullness: 0.55,
    cheekboneProminence: 0.78, faceRoundness: 0.4,
    skinL: 0.7, skinA: 0.54, skinB: 0.58, hairL: 0.3, hairA: 0.5, hairB: 0.5,
    masculine: 0.3, feminine: 0.8, youthfulness: 0.55,
  }),
  c("zoe-kravitz", "Zoë Kravitz", "Actor", ["cat eyes", "fine features"], 270, {
    faceAspect: 0.52, jawWidth: 0.48, chinSharpness: 0.7, foreheadHeight: 0.55,
    eyeSpacing: 0.58, eyeOpenness: 0.55, eyeSlant: 0.58, browHeight: 0.55,
    noseLength: 0.5, noseWidth: 0.42, mouthWidth: 0.5, lipFullness: 0.55,
    cheekboneProminence: 0.78, faceRoundness: 0.38,
    skinL: 0.45, skinA: 0.55, skinB: 0.56, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.25, feminine: 0.82, youthfulness: 0.62,
  }),
  c("harry-styles", "Harry Styles", "Artist", ["soft features", "full hair"], 330, {
    faceAspect: 0.58, jawWidth: 0.52, chinSharpness: 0.5, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.58, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.5, noseWidth: 0.48, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.74, skinA: 0.52, skinB: 0.55, hairL: 0.35, hairA: 0.5, hairB: 0.52,
    masculine: 0.5, feminine: 0.55, youthfulness: 0.65,
  }),
  c("beyonce", "Beyoncé", "Artist", ["radiant", "defined cheekbones"], 45, {
    faceAspect: 0.55, jawWidth: 0.52, chinSharpness: 0.65, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.52, browHeight: 0.55,
    noseLength: 0.5, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.7,
    cheekboneProminence: 0.78, faceRoundness: 0.45,
    skinL: 0.45, skinA: 0.56, skinB: 0.58, hairL: 0.4, hairA: 0.55, hairB: 0.58,
    masculine: 0.2, feminine: 0.9, youthfulness: 0.58,
  }),
  c("the-weeknd", "The Weeknd", "Artist", ["angular", "high cheekbones"], 0, {
    faceAspect: 0.52, jawWidth: 0.55, chinSharpness: 0.7, foreheadHeight: 0.58,
    eyeSpacing: 0.56, eyeOpenness: 0.5, eyeSlant: 0.5, browHeight: 0.55,
    noseLength: 0.58, noseWidth: 0.5, mouthWidth: 0.5, lipFullness: 0.45,
    cheekboneProminence: 0.8, faceRoundness: 0.35,
    skinL: 0.42, skinA: 0.55, skinB: 0.56, hairL: 0.18, hairA: 0.5, hairB: 0.48,
    masculine: 0.72, feminine: 0.35, youthfulness: 0.5,
  }),
  c("dua-lipa", "Dua Lipa", "Artist", ["cat eyes", "defined jaw"], 280, {
    faceAspect: 0.55, jawWidth: 0.55, chinSharpness: 0.68, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.55, eyeSlant: 0.58, browHeight: 0.55,
    noseLength: 0.5, noseWidth: 0.45, mouthWidth: 0.52, lipFullness: 0.6,
    cheekboneProminence: 0.75, faceRoundness: 0.42,
    skinL: 0.72, skinA: 0.53, skinB: 0.55, hairL: 0.22, hairA: 0.5, hairB: 0.48,
    masculine: 0.22, feminine: 0.88, youthfulness: 0.65,
  }),
  c("bad-bunny", "Bad Bunny", "Artist", ["soft jaw", "expressive"], 300, {
    faceAspect: 0.6, jawWidth: 0.55, chinSharpness: 0.45, foreheadHeight: 0.5,
    eyeSpacing: 0.54, eyeOpenness: 0.55, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.5, noseWidth: 0.55, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.55, faceRoundness: 0.6,
    skinL: 0.58, skinA: 0.55, skinB: 0.58, hairL: 0.35, hairA: 0.5, hairB: 0.5,
    masculine: 0.55, feminine: 0.5, youthfulness: 0.6,
  }),
  c("serena-williams", "Serena Williams", "Athlete", ["powerful presence", "warm"], 18, {
    faceAspect: 0.6, jawWidth: 0.65, chinSharpness: 0.55, foreheadHeight: 0.5,
    eyeSpacing: 0.54, eyeOpenness: 0.55, eyeSlant: 0.5, browHeight: 0.55,
    noseLength: 0.52, noseWidth: 0.55, mouthWidth: 0.58, lipFullness: 0.6,
    cheekboneProminence: 0.62, faceRoundness: 0.55,
    skinL: 0.35, skinA: 0.55, skinB: 0.55, hairL: 0.3, hairA: 0.5, hairB: 0.5,
    masculine: 0.35, feminine: 0.75, youthfulness: 0.45,
  }),
  c("jacob-elordi", "Jacob Elordi", "Actor", ["long face", "tall features"], 210, {
    faceAspect: 0.5, jawWidth: 0.62, chinSharpness: 0.6, foreheadHeight: 0.58,
    eyeSpacing: 0.55, eyeOpenness: 0.5, eyeSlant: 0.48, browHeight: 0.52,
    noseLength: 0.6, noseWidth: 0.48, mouthWidth: 0.5, lipFullness: 0.42,
    cheekboneProminence: 0.65, faceRoundness: 0.35,
    skinL: 0.74, skinA: 0.52, skinB: 0.55, hairL: 0.32, hairA: 0.5, hairB: 0.5,
    masculine: 0.78, feminine: 0.28, youthfulness: 0.6,
  }),
  c("jenna-ortega", "Jenna Ortega", "Actor", ["dark features", "youthful"], 260, {
    faceAspect: 0.55, jawWidth: 0.5, chinSharpness: 0.65, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.58, eyeSlant: 0.55, browHeight: 0.55,
    noseLength: 0.5, noseWidth: 0.45, mouthWidth: 0.5, lipFullness: 0.55,
    cheekboneProminence: 0.72, faceRoundness: 0.45,
    skinL: 0.62, skinA: 0.55, skinB: 0.56, hairL: 0.15, hairA: 0.5, hairB: 0.48,
    masculine: 0.2, feminine: 0.88, youthfulness: 0.8,
  }),
  c("daniel-kaluuya", "Daniel Kaluuya", "Actor", ["expressive eyes", "warm"], 22, {
    faceAspect: 0.6, jawWidth: 0.62, chinSharpness: 0.5, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.62, eyeSlant: 0.5, browHeight: 0.52,
    noseLength: 0.52, noseWidth: 0.58, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.32, skinA: 0.55, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.72, feminine: 0.32, youthfulness: 0.5,
  }),
  c("ali-wong", "Ali Wong", "Comedian", ["expressive", "bright smile"], 45, {
    faceAspect: 0.58, jawWidth: 0.52, chinSharpness: 0.5, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.58, eyeSlant: 0.55, browHeight: 0.5,
    noseLength: 0.48, noseWidth: 0.48, mouthWidth: 0.6, lipFullness: 0.55,
    cheekboneProminence: 0.6, faceRoundness: 0.55,
    skinL: 0.62, skinA: 0.54, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.28, feminine: 0.78, youthfulness: 0.55,
  }),
  c("rami-malek", "Rami Malek", "Actor", ["wide eyes", "angular"], 200, {
    faceAspect: 0.52, jawWidth: 0.5, chinSharpness: 0.65, foreheadHeight: 0.58,
    eyeSpacing: 0.6, eyeOpenness: 0.7, eyeSlant: 0.5, browHeight: 0.55,
    noseLength: 0.55, noseWidth: 0.48, mouthWidth: 0.5, lipFullness: 0.45,
    cheekboneProminence: 0.7, faceRoundness: 0.38,
    skinL: 0.62, skinA: 0.54, skinB: 0.56, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.6, feminine: 0.45, youthfulness: 0.52,
  }),
  c("elizabeth-olsen", "Elizabeth Olsen", "Actor", ["soft features", "wide eyes"], 350, {
    faceAspect: 0.58, jawWidth: 0.5, chinSharpness: 0.55, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.65, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.48, noseWidth: 0.45, mouthWidth: 0.52, lipFullness: 0.55,
    cheekboneProminence: 0.62, faceRoundness: 0.52,
    skinL: 0.78, skinA: 0.53, skinB: 0.55, hairL: 0.4, hairA: 0.52, hairB: 0.55,
    masculine: 0.2, feminine: 0.88, youthfulness: 0.6,
  }),
  c("john-boyega", "John Boyega", "Actor", ["bright smile", "warm"], 15, {
    faceAspect: 0.6, jawWidth: 0.62, chinSharpness: 0.55, foreheadHeight: 0.5,
    eyeSpacing: 0.54, eyeOpenness: 0.58, eyeSlant: 0.5, browHeight: 0.5,
    noseLength: 0.5, noseWidth: 0.55, mouthWidth: 0.58, lipFullness: 0.55,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.32, skinA: 0.55, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.75, feminine: 0.3, youthfulness: 0.55,
  }),
  c("millie-bobby-brown", "Millie Bobby Brown", "Actor", ["youthful", "big eyes"], 200, {
    faceAspect: 0.58, jawWidth: 0.48, chinSharpness: 0.55, foreheadHeight: 0.5,
    eyeSpacing: 0.56, eyeOpenness: 0.7, eyeSlant: 0.5, browHeight: 0.48,
    noseLength: 0.45, noseWidth: 0.45, mouthWidth: 0.52, lipFullness: 0.55,
    cheekboneProminence: 0.6, faceRoundness: 0.58,
    skinL: 0.78, skinA: 0.53, skinB: 0.55, hairL: 0.35, hairA: 0.5, hairB: 0.5,
    masculine: 0.18, feminine: 0.85, youthfulness: 0.88,
  }),
  c("chris-evans", "Chris Evans", "Actor", ["all-American", "square jaw"], 210, {
    faceAspect: 0.62, jawWidth: 0.75, chinSharpness: 0.65, foreheadHeight: 0.5,
    eyeSpacing: 0.52, eyeOpenness: 0.52, eyeSlant: 0.48, browHeight: 0.52,
    noseLength: 0.52, noseWidth: 0.5, mouthWidth: 0.55, lipFullness: 0.45,
    cheekboneProminence: 0.65, faceRoundness: 0.48,
    skinL: 0.72, skinA: 0.53, skinB: 0.56, hairL: 0.35, hairA: 0.52, hairB: 0.55,
    masculine: 0.85, feminine: 0.2, youthfulness: 0.5,
  }),
  c("tiffany-haddish", "Tiffany Haddish", "Comedian", ["radiant smile", "expressive"], 30, {
    faceAspect: 0.6, jawWidth: 0.55, chinSharpness: 0.5, foreheadHeight: 0.5,
    eyeSpacing: 0.55, eyeOpenness: 0.6, eyeSlant: 0.5, browHeight: 0.52,
    noseLength: 0.5, noseWidth: 0.55, mouthWidth: 0.62, lipFullness: 0.65,
    cheekboneProminence: 0.6, faceRoundness: 0.58,
    skinL: 0.38, skinA: 0.55, skinB: 0.55, hairL: 0.3, hairA: 0.5, hairB: 0.5,
    masculine: 0.25, feminine: 0.8, youthfulness: 0.5,
  }),
  c("andrew-garfield", "Andrew Garfield", "Actor", ["angular", "expressive eyes"], 25, {
    faceAspect: 0.52, jawWidth: 0.55, chinSharpness: 0.65, foreheadHeight: 0.58,
    eyeSpacing: 0.58, eyeOpenness: 0.6, eyeSlant: 0.5, browHeight: 0.52,
    noseLength: 0.58, noseWidth: 0.48, mouthWidth: 0.5, lipFullness: 0.45,
    cheekboneProminence: 0.7, faceRoundness: 0.38,
    skinL: 0.74, skinA: 0.52, skinB: 0.55, hairL: 0.32, hairA: 0.5, hairB: 0.5,
    masculine: 0.68, feminine: 0.38, youthfulness: 0.52,
  }),
  c("sandra-oh", "Sandra Oh", "Actor", ["expressive", "warm eyes"], 10, {
    faceAspect: 0.58, jawWidth: 0.52, chinSharpness: 0.55, foreheadHeight: 0.52,
    eyeSpacing: 0.56, eyeOpenness: 0.58, eyeSlant: 0.55, browHeight: 0.5,
    noseLength: 0.5, noseWidth: 0.48, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.65, faceRoundness: 0.5,
    skinL: 0.6, skinA: 0.54, skinB: 0.55, hairL: 0.2, hairA: 0.5, hairB: 0.48,
    masculine: 0.25, feminine: 0.82, youthfulness: 0.48,
  }),
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0) / 4294967296;
}

const FEMALE_NAME_PATTERNS = [
  "aanya", "ada", "adele", "adriana", "aishwarya", "alia", "alicia", "ali", "amy", "ana", "angelina",
  "anna", "anya", "ariana", "awkwafina", "bella", "beyonce", "blake", "brie", "britney", "cara",
  "cardi", "cate", "charlize", "chloe", "dakota", "deepika", "doja", "drew", "dua", "elizabeth",
  "emily", "emma", "eva", "fan", "florence", "gal", "gemma", "gigi", "gong", "gwyneth", "hailee",
  "heidi", "helen", "helena", "hunter", "iu", "jennie", "jennifer", "jenna", "jessica", "jisoo",
  "julia", "kate", "keira", "kendall", "kerry", "kim", "kristen", "kylie", "lady", "lana", "liu",
  "lupita", "margot", "meryl", "michelle", "millie", "natalie", "nicole", "oprah", "priyanka",
  "rihanna", "salma", "sandra", "scarlett", "selena", "serena", "sydney", "taylor", "tiffany",
  "uzo", "viola", "yara", "zendaya", "zoe", "camila", "olivia", "sabrina", "chloe", "halle",
];

function inferFemaleFromId(id: string): boolean {
  const lower = id.toLowerCase();
  return FEMALE_NAME_PATTERNS.some((p) => lower.includes(p));
}

export function generateDemographicFeatures(
  gender: "male" | "female" | string = "male",
  genderProb = 0.85,
  age = 35,
  id = "",
): FaceFeatures {
  const isFemale = gender === "female" || (gender !== "male" && inferFemaleFromId(id));
  const p = Math.max(0.5, Math.min(1, genderProb));
  const h = (s: string) => hashString(id + s);

  const faceAspect = 0.52 + h("-aspect") * 0.12;
  const jawWidth = isFemale ? 0.46 + h("-jaw") * 0.10 : 0.64 + p * 0.12 + h("-jaw") * 0.08;
  const chinSharpness = isFemale ? 0.58 + h("-chin") * 0.12 : 0.62 + h("-chin") * 0.12;
  const foreheadHeight = 0.50 + h("-forehead") * 0.10;
  const eyeSpacing = 0.52 + h("-eyespace") * 0.08;
  const eyeOpenness = isFemale ? 0.56 + h("-eyeopen") * 0.12 : 0.48 + h("-eyeopen") * 0.10;
  const eyeSlant = 0.50 + h("-eyeslant") * 0.08;
  const browHeight = isFemale ? 0.50 + h("-brow") * 0.08 : 0.54 + h("-brow") * 0.08;
  const noseLength = 0.50 + h("-noselen") * 0.10;
  const noseWidth = isFemale ? 0.44 + h("-nosewid") * 0.08 : 0.52 + h("-nosewid") * 0.10;
  const mouthWidth = 0.50 + h("-mouthwid") * 0.10;
  const lipFullness = isFemale ? 0.58 + h("-lip") * 0.16 : 0.44 + h("-lip") * 0.10;
  const cheekboneProminence = isFemale ? 0.68 + h("-cheek") * 0.14 : 0.60 + h("-cheek") * 0.12;
  const faceRoundness = isFemale ? 0.48 + h("-round") * 0.12 : 0.42 + h("-round") * 0.10;

  const skinL = 0.55 + h("-skinL") * 0.22;
  const skinA = 0.52 + h("-skinA") * 0.05;
  const skinB = 0.54 + h("-skinB") * 0.05;
  const hairL = 0.20 + h("-hairL") * 0.40;
  const hairA = 0.50 + h("-hairA") * 0.04;
  const hairB = 0.48 + h("-hairB") * 0.08;

  const masculine = isFemale
    ? 0.18 + (1 - p) * 0.10 + h("-masc") * 0.08
    : 0.72 + p * 0.15 + h("-masc") * 0.08;
  const feminine = isFemale
    ? 0.72 + p * 0.18 + h("-fem") * 0.08
    : 0.18 + (1 - p) * 0.10 + h("-fem") * 0.08;

  const ageFactor = Math.max(0, Math.min(1, (60 - age) / 50));
  const youthfulness = Math.max(0.2, Math.min(0.9, 0.35 + ageFactor * 0.45 + h("-youth") * 0.10));

  return mergeFeatures({
    faceAspect,
    jawWidth,
    chinSharpness,
    foreheadHeight,
    eyeSpacing,
    eyeOpenness,
    eyeSlant,
    browHeight,
    noseLength,
    noseWidth,
    mouthWidth,
    lipFullness,
    cheekboneProminence,
    faceRoundness,
    skinL,
    skinA,
    skinB,
    hairL,
    hairA,
    hairB,
    masculine,
    feminine,
    youthfulness,
  });
}

function generateFeaturesForId(id: string): FaceFeatures {
  const isFemale = inferFemaleFromId(id);
  return generateDemographicFeatures(isFemale ? "female" : "male", 0.85, 35, id);
}

export function getCelebrityById(id: string): CelebrityProfile | undefined {
  const found = CELEBRITIES.find((c) => c.id === id);
  if (found) return found;
  if (!id) return undefined;

  const name = id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return {
    id,
    name,
    knownFor: "Celebrity",
    tags: ["gallery"],
    accentHue: Math.floor(hashString(id + "-hue") * 360),
    features: generateFeaturesForId(id),
  };
}

export function celebrityCount(): number {
  return CELEBRITIES.length;
}

