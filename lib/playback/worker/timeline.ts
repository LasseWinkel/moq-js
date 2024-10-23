import type { Frame } from "../../media/mp4"
export type { Frame }

// Helper function to nicely display time strings
function createTimeString(millisecondsInput: number): string {
	const hours = Math.floor(millisecondsInput / 3600000) // 1 hour = 3600000 milliseconds
	const minutes = Math.floor((millisecondsInput % 3600000) / 60000) // 1 minute = 60000 milliseconds
	const seconds = Math.floor((millisecondsInput % 60000) / 1000) // 1 second = 1000 milliseconds
	const milliseconds = Math.floor(millisecondsInput % 1000) // Remaining milliseconds

	// Format the time
	const formattedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
		seconds,
	).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`

	return formattedTime
}

export interface Range {
	start: number
	end: number
}

export class Timeline {
	// Maintain audio and video seprarately
	audio: Component
	video: Component

	// Construct a timeline
	constructor() {
		this.audio = new Component()
		this.video = new Component()
	}
}

interface Segment {
	sequence: number
	frames: ReadableStream<Frame>
}

export class Component {
	#current?: Segment

	frames: ReadableStream<Frame>
	#segments: TransformStream<Segment, Segment>

	currentSegments: Map<number, Segment> = new Map()
	startTime = 0
	maxFrameID = 0

	constructor() {
		this.frames = new ReadableStream({
			pull: this.#pull.bind(this),
			cancel: this.#cancel.bind(this),
		})

		// This is a hack to have an async channel with 100 items.
		this.#segments = new TransformStream({}, { highWaterMark: 100 })
	}

	get segments() {
		return this.#segments.writable
	}

	async #pull(controller: ReadableStreamDefaultController<Frame>) {
		this.startTime = Date.now()
		for (;;) {
			console.log("\nNew Iteration", createTimeString(Date.now() - this.startTime))

			console.log("Current segments", this.currentSegments)

			// Get the next segment to render.
			const segments = this.#segments.readable.getReader()

			let frames0: ReadableStreamDefaultReader<Frame> | undefined
			let frames1: ReadableStreamDefaultReader<Frame> | undefined
			let frames2: ReadableStreamDefaultReader<Frame> | undefined
			let frames3: ReadableStreamDefaultReader<Frame> | undefined
			let frames4: ReadableStreamDefaultReader<Frame> | undefined
			let frames5: ReadableStreamDefaultReader<Frame> | undefined
			let mapIndex = 0

			if (this.currentSegments.size > 0) {
				for (const [_key, value] of this.currentSegments) {
					const frames = value.frames.getReader()
					if (mapIndex === 0) {
						frames0 = frames
					} else if (mapIndex === 1) {
						frames1 = frames
					} else if (mapIndex === 2) {
						frames2 = frames
					} else if (mapIndex === 3) {
						frames3 = frames
					} else if (mapIndex === 4) {
						frames4 = frames
					} else if (mapIndex === 5) {
						frames5 = frames
					}
					mapIndex++
				}
			}

			let res
			switch (this.currentSegments.size) {
				case 0:
					console.log("Case", 0)

					res = await Promise.race([segments.read()])
					break
				case 1:
					console.log("Case", 1)

					res = await Promise.race([frames0?.read(), segments.read()])
					frames0?.releaseLock()
					break
				case 2:
					console.log("Case", 2)

					res = await Promise.race([frames0?.read(), frames1?.read(), segments.read()])
					frames0?.releaseLock()
					frames1?.releaseLock()

					break
				case 3:
					console.log("Case", 3)

					res = await Promise.race([frames0?.read(), frames1?.read(), frames2?.read(), segments.read()])
					frames0?.releaseLock()
					frames1?.releaseLock()
					frames2?.releaseLock()
					break
				case 4:
					console.log("Case", 4)

					res = await Promise.race([
						frames0?.read(),
						frames1?.read(),
						frames2?.read(),
						frames3?.read(),
						segments.read(),
					])
					frames0?.releaseLock()
					frames1?.releaseLock()
					frames2?.releaseLock()
					frames3?.releaseLock()
					break
				case 5:
					console.log("Case", 5)

					res = await Promise.race([
						frames0?.read(),
						frames1?.read(),
						frames2?.read(),
						frames3?.read(),
						frames4?.read(),
						segments.read(),
					])
					frames0?.releaseLock()
					frames1?.releaseLock()
					frames2?.releaseLock()
					frames3?.releaseLock()
					frames4?.releaseLock()
					break
				case 6:
					console.log("Case", 6, "Segment overflow")

					res = { value: {} as Frame, done: true }
					frames0?.releaseLock()
					frames1?.releaseLock()
					frames2?.releaseLock()
					frames3?.releaseLock()
					frames4?.releaseLock()
					frames5?.releaseLock()
					break

				default:
					break
			}

			segments.releaseLock()

			if (!res) {
				console.log("Nothing read")

				continue
			}

			const { value, done } = res

			if (done) {
				// We assume the current segment has been closed
				// TODO support the segments stream closing
				const oldestSegment = Math.min(...this.currentSegments.keys())
				console.log("Done. Delete", oldestSegment)
				this.currentSegments.delete(oldestSegment)
				continue
			}

			if (isSegment(value)) {
				console.log("Segment", value.sequence)

				this.currentSegments.set(value.sequence, value)
				continue
			}

			if (!isSegment(value)) {
				if (value.sample.duration > this.maxFrameID) {
					this.maxFrameID = value.sample.duration
					console.log(value.sample.is_sync ? "I" : "P", "Frame", value.sample.duration)

					controller.enqueue(value)
					// Skip all old segments when an I-Frame arrives.
					if (value.sample.is_sync) {
						/* const frame = await IDBService.retrieveFrameFromIndexedDB(value.sample.duration)
					for (let i = this.oldestSegment - 1; i < frame._19_segmentID; i++) {
						const segment = this.currentSegments.get(i)
						await segment?.frames.cancel(`skipping segment ${segment?.sequence}; too old`)
						this.currentSegments.delete(i)
					}
					this.oldestSegment = value.sample.duration */
						if (this.currentSegments.size > 1) {
							const oldestSegment = Math.min(...this.currentSegments.keys())
							console.log("Skipping", oldestSegment)

							await this.currentSegments
								.get(oldestSegment)
								?.frames.cancel(`skipping segment ${oldestSegment}; too slow`)
							this.currentSegments.delete(oldestSegment)
						}
					}
				} else {
					console.log(`Skipping frame ${value.sample.duration}, maxFrameID is ${this.maxFrameID}`)
				}
			}
			continue
		}
	}

	async #cancel(reason: any) {
		if (this.#current) {
			await this.#current.frames.cancel(reason)
		}

		const segments = this.#segments.readable.getReader()
		for (;;) {
			const { value: segment, done } = await segments.read()
			if (done) break

			await segment.frames.cancel(reason)
		}
	}
}

// Return if a type is a segment or frame
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function isSegment(value: Segment | Frame): value is Segment {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	return (value as Segment).frames !== undefined
}
