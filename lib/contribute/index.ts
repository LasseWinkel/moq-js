export { Broadcast } from "./broadcast"
export type { BroadcastConfig, BroadcastConfigTrack } from "./broadcast"

export { Encoder as VideoEncoder } from "./video"
export { Encoder as AudioEncoder } from "./audio"

export { IndexedDBObjectStores } from "./video"
export type { IndexedDBFramesSchema } from "./video"
export { IndexedDatabaseName } from "./video"

export interface FrameData {
	frameId: number
	size: number
	type: string
	receiveTime: number
	width: number
	height: number
}

export interface SegmentData {
	id: number
	propagationTime: number
}

export enum IndexedDBObjectStoresSubscriber {
	SEGMENTS = "Segments",
	FRAMES = "Frames",
}
