export interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  blobUrl: string | null;
}

export interface CropDimensions {
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

export enum TrackingMode {
  MANUAL = 'MANUAL',
  SMOOTH_FOLLOW = 'SMOOTH_FOLLOW',
  AUTO_TRACK = 'AUTO_TRACK'
}