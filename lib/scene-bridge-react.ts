import { useSyncExternalStore } from "react";
import {
  getSceneMode,
  getSceneStatus,
  getSceneYou,
  getStoryStep,
  subscribeScene,
  subscribeSceneStatus,
  subscribeStoryStep,
  type SceneMode,
  type SceneStatus,
} from "./scene-bridge";
import type { Party } from "./palette";

const IDLE: SceneMode = { kind: "idle" };
const serverMode = (): SceneMode => IDLE;
const serverStatus = (): SceneStatus => "loading";
const serverStep = (): number => -1;
const serverYou = (): Party | null => null;

export function useSceneMode(): SceneMode {
  return useSyncExternalStore(subscribeScene, getSceneMode, serverMode);
}

export function useSceneYou(): Party | null {
  return useSyncExternalStore(subscribeScene, getSceneYou, serverYou);
}

export function useSceneStatus(): SceneStatus {
  return useSyncExternalStore(subscribeSceneStatus, getSceneStatus, serverStatus);
}

export function useStoryStep(): number {
  return useSyncExternalStore(subscribeStoryStep, getStoryStep, serverStep);
}
