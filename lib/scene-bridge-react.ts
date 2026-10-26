import { useSyncExternalStore } from "react";
import {
  getSceneMode,
  getSceneStatus,
  getStoryStep,
  subscribeScene,
  subscribeSceneStatus,
  subscribeStoryStep,
  type SceneMode,
  type SceneStatus,
} from "./scene-bridge";

const IDLE: SceneMode = { kind: "idle" };
const serverMode = (): SceneMode => IDLE;
const serverStatus = (): SceneStatus => "loading";
const serverStep = (): number => -1;

export function useSceneMode(): SceneMode {
  return useSyncExternalStore(subscribeScene, getSceneMode, serverMode);
}

export function useSceneStatus(): SceneStatus {
  return useSyncExternalStore(subscribeSceneStatus, getSceneStatus, serverStatus);
}

export function useStoryStep(): number {
  return useSyncExternalStore(subscribeStoryStep, getStoryStep, serverStep);
}
