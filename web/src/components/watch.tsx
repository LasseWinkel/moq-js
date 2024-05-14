/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback"

import { IndexedDatabaseName, IndexedDBObjectStores } from "@kixelated/moq/contribute"
import type { IndexedDBFramesSchema } from "@kixelated/moq/contribute"

import FramesPlot from "./frames"
import BitratePlot from "./bitrate"

import Fail from "./fail"

import { createEffect, createSignal, onCleanup } from "solid-js"

export interface IndexedDBBitRateWithTimestampSchema {
	bitrate: number
	timestamp: number
}

// Data update rate in milliseconds
const DATA_UPDATE_RATE = 500

// The time interval for the latest data in seconds
const LATEST_DATA_DISPLAY_INTERVAL = 3

// Time until data download in seconds
const DATA_DOWNLOAD_TIME = 60

// Helper function to nicely display large numbers
function formatNumber(number: number): string {
	const suffixes = ["", "k", "M", "B", "T"] // Add more suffixes as needed
	const suffixIndex = Math.floor(Math.log10(number) / 3)
	const scaledNumber = number / Math.pow(10, suffixIndex * 3)
	const suffix = suffixes[suffixIndex]
	return scaledNumber.toFixed(2) + suffix
}

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

// Utility function to download collected data.
function downloadFrameData(frames: IndexedDBFramesSchema[]): void {
	const jsonData = JSON.stringify(frames)
	const blob = new Blob([jsonData], {
		type: "application/json",
	})

	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	link.download = "frame_metadata"

	// Append the link to the body
	document.body.appendChild(link)

	// Programmatically click the link to trigger the download
	link.click()

	// Clean up
	document.body.removeChild(link)
}

let db: IDBDatabase // Declare db variable at the worker scope

// Open or create a database
const openRequest = indexedDB.open(IndexedDatabaseName, 1)

// Handle the success event when the database is successfully opened
openRequest.onsuccess = (event) => {
	db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
}

// Function to retrieve all frame data from IndexedDB
function retrieveFramesFromIndexedDB(): Promise<IndexedDBFramesSchema[]> {
	return new Promise((resolve, reject) => {
		if (!db) {
			reject(new Error("IndexedDB is not initialized."))
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readonly")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
		const getRequest = objectStore.getAll() // Get all stored values from the database

		// Handle the success event when the values are retrieved successfully
		getRequest.onsuccess = (event) => {
			const storedValues = (event.target as IDBRequest).result as IndexedDBFramesSchema[]
			resolve(storedValues)
		}

		// Handle any errors that occur during value retrieval
		getRequest.onerror = (event) => {
			console.error("Error retrieving value:", (event.target as IDBRequest).error)
			reject((event.target as IDBRequest).error)
		}
	})
}

// Function to get the start time of the stream in IndexedDB
const getStreamStartTime = (): Promise<number> => {
	return new Promise((resolve, reject) => {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.START_STREAM_TIME, "readonly")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.START_STREAM_TIME)
		const getRequest = objectStore.get(1)

		// Handle the success event when the updated value is stored successfully
		getRequest.onsuccess = (event) => {
			const startTime = (event.target as IDBRequest).result as number
			// console.log("Start time successfully retrieved:", startTime)
			resolve(startTime)
		}

		// Handle any errors that occur during value retrieval
		getRequest.onerror = (event) => {
			console.error("Error adding start time:", (event.target as IDBRequest).error)
			reject((event.target as IDBRequest).error)
		}
	})
}

export default function Watch(props: { name: string }) {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? import.meta.env.PUBLIC_RELAY_HOST

	const [error, setError] = createSignal<Error | undefined>()

	// Various dynamic meta data to be displayed next to the video
	const [streamStartTime, setStreamStartTime] = createSignal<number>(0)
	const [streamRunningTime, setStreamRunningTime] = createSignal<number>(0)
	const [streamWatchTime, setStreamWatchTime] = createSignal<number>(0)
	const [streamStartWatchTime, setStreamStartWatchTime] = createSignal<number>(0)
	const [totalAmountRecvBytes, setTotalAmountRecvBytes] = createSignal<number>(0)
	const [allFrames, setAllFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [receivedFrames, setReceivedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [latestFrames, setLatestFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [percentageReceivedFrames, setPercentageReceivedFrames] = createSignal<number>(0.0)

	const [minSegmentationTime, setMinSegmentationTime] = createSignal<number>(0)
	const [maxSegmentationTime, setMaxSegmentationTime] = createSignal<number>(0)
	const [avgSegmentationTime, setAvgSegmentationTime] = createSignal<number>(0.0)
	const [minPropagationTime, setMinPropagationTime] = createSignal<number>(0)
	const [maxPropagationTime, setMaxPropagationTime] = createSignal<number>(0)
	const [avgPropagationTime, setAvgPropagationTime] = createSignal<number>(0.0)
	const [minRenderTime, setMinRenderTime] = createSignal<number>(0)
	const [maxRenderTime, setMaxRenderTime] = createSignal<number>(0)
	const [avgRenderTime, setAvgRenderTime] = createSignal<number>(0.0)
	const [minTotalTime, setMinTotalTime] = createSignal<number>(0)
	const [maxTotalTime, setMaxTotalTime] = createSignal<number>(0)
	const [avgTotalTime, setAvgTotalTime] = createSignal<number>(0.0)

	const [minLatestSegmentationTime, setMinLatestSegmentationTime] = createSignal<number>(0)
	const [maxLatestSegmentationTime, setMaxLatestSegmentationTime] = createSignal<number>(0)
	const [avgLatestSegmentationTime, setAvgLatestSegmentationTime] = createSignal<number>(0.0)
	const [minLatestPropagationTime, setMinLatestPropagationTime] = createSignal<number>(0)
	const [maxLatestPropagationTime, setMaxLatestPropagationTime] = createSignal<number>(0)
	const [avgLatestPropagationTime, setAvgLatestPropagationTime] = createSignal<number>(0.0)
	const [minLatestRenderTime, setMinLatestRenderTime] = createSignal<number>(0)
	const [maxLatestRenderTime, setMaxLatestRenderTime] = createSignal<number>(0)
	const [avgLatestRenderTime, setAvgLatestRenderTime] = createSignal<number>(0.0)
	const [minLatestTotalTime, setMinLatestTotalTime] = createSignal<number>(0)
	const [maxLatestTotalTime, setMaxLatestTotalTime] = createSignal<number>(0)
	const [avgLatestTotalTime, setAvgLatestTotalTime] = createSignal<number>(0.0)

	const [lastRenderedFrameSegmentationTime, setLastRenderedFrameSegmentationTime] = createSignal<number>(0)
	const [lastRenderedFramePropagationTime, setLastRenderedFramePropagationTime] = createSignal<number>(0)
	const [lastRenderedFrameRenderTime, setLastRenderedFrameRenderTime] = createSignal<number>(0)
	const [lastRenderedFrameTotalTime, setLastRenderedFrameTotalTime] = createSignal<number>(0)

	const [showFramesPlot, setShowFramesPlot] = createSignal<boolean>(false)
	const [showBitratePlot, setShowBitratePlot] = createSignal<boolean>(false)

	const [bitratePlotData, setBitratePlotData] = createSignal<IndexedDBBitRateWithTimestampSchema[]>([])
	const [bitRate, setBitRate] = createSignal<number>(0.0)
	const [framesPerSecond, setFramesPerSecond] = createSignal<number>(0.0)

	const [isRecording, setIsRecording] = createSignal<boolean>(false)

	// Define a function to update the data every second
	const updateDataInterval = setInterval(() => {
		// Function to retrieve data from the IndexedDB
		const retrieveData = async () => {
			if (streamStartTime() === 0) {
				setStreamStartTime(await getStreamStartTime())
				setStreamStartWatchTime(Date.now())

				// Record the received video
				/* setIsRecording(true)
				const stream = canvas.captureStream()
				console.log(stream)

				const recordedBlobs: BlobPart[] = []
				const mediaRecorder = new MediaRecorder(stream, {
					videoBitsPerSecond: 4000000,
					videoKeyFrameIntervalCount: 60,
				})
				console.log("Video bits per second", mediaRecorder.videoBitsPerSecond)
				mediaRecorder.ondataavailable = (event) => {
					if (event.data && event.data.size > 0) {
						recordedBlobs.push(event.data)
					}
				}

				mediaRecorder.start()

				mediaRecorder.onstop = function () {
					setIsRecording(false)
					const blob = new Blob(recordedBlobs, { type: "video/mp4" })
					const url = URL.createObjectURL(blob)
					const a = document.createElement("a")
					a.href = url
					a.download = "received_video.mp4"
					a.click()
					URL.revokeObjectURL(url)
				} */

				setTimeout(() => {
					// mediaRecorder.stop()
					downloadFrameData(allFrames())
				}, DATA_DOWNLOAD_TIME * 1000)
			}

			const frames = await retrieveFramesFromIndexedDB()

			// Ignore first few frames since none of these frames will acutally be received
			const firstReceivedFrameIndex =
				frames.slice(60).findIndex((frame) => frame._5_receiveMp4FrameTimestamp !== undefined) + 60
			// console.log("FIRST_RECEVIED_FRAME_INDEX", firstReceivedFrameIndex)

			const allReceivedFrames = frames
				.slice(firstReceivedFrameIndex)
				.filter((frame) => frame._7_renderFrameTimestamp !== undefined)

			// ALL FRAMES

			setAllFrames(frames)
			setReceivedFrames(allReceivedFrames)
			setPercentageReceivedFrames(allReceivedFrames.length / frames.slice(firstReceivedFrameIndex).length)

			let totalAmountRecvBytes = 0
			let minSegmentationTime = Number.MAX_SAFE_INTEGER
			let maxSegmentationTime = Number.MIN_SAFE_INTEGER
			let sumSegmentationTime = 0
			let minPropagationTime = Number.MAX_SAFE_INTEGER
			let maxPropagationTime = Number.MIN_SAFE_INTEGER
			let sumPropagationTime = 0
			let minRenderTime = Number.MAX_SAFE_INTEGER
			let maxRenderTime = Number.MIN_SAFE_INTEGER
			let sumRenderTime = 0
			let minTotalTime = Number.MAX_SAFE_INTEGER
			let maxTotalTime = Number.MIN_SAFE_INTEGER
			let sumTotalTime = 0
			allReceivedFrames.forEach((frame) => {
				totalAmountRecvBytes += frame._14_receivedBytes
				const frameSegmentationTime = frame._2_segmentationTime
				if (frameSegmentationTime < minSegmentationTime) {
					minSegmentationTime = frameSegmentationTime
				}
				if (frameSegmentationTime > maxSegmentationTime) {
					maxSegmentationTime = frameSegmentationTime
				}
				if (frameSegmentationTime) {
					sumSegmentationTime += frameSegmentationTime
				}

				const framePropagationTime = frame._4_propagationTime
				if (framePropagationTime < minPropagationTime) {
					minPropagationTime = framePropagationTime
				}
				if (framePropagationTime > maxPropagationTime) {
					maxPropagationTime = framePropagationTime
				}
				if (framePropagationTime) {
					sumPropagationTime += framePropagationTime
				}

				const frameRenderTime = frame._6_renderFrameTime
				if (frameRenderTime < minRenderTime) {
					minRenderTime = frameRenderTime
				}
				if (frameRenderTime > maxRenderTime) {
					maxRenderTime = frameRenderTime
				}
				if (frameRenderTime) {
					sumRenderTime += frameRenderTime
				}

				const frameTotalTime = frame._8_totalTime
				if (frameTotalTime < minTotalTime) {
					minTotalTime = frameTotalTime
				}
				if (frameTotalTime > maxTotalTime) {
					maxTotalTime = frameTotalTime
				}
				if (frameTotalTime) {
					sumTotalTime += frameTotalTime
				}
			})

			setTotalAmountRecvBytes(totalAmountRecvBytes)

			setMinSegmentationTime(minSegmentationTime)
			setMaxSegmentationTime(maxSegmentationTime)
			setAvgSegmentationTime(sumSegmentationTime / allReceivedFrames.length)

			setMinPropagationTime(minPropagationTime)
			setMaxPropagationTime(maxPropagationTime)
			setAvgPropagationTime(sumPropagationTime / allReceivedFrames.length)

			setMinRenderTime(minRenderTime)
			setMaxRenderTime(maxRenderTime)
			setAvgRenderTime(sumRenderTime / allReceivedFrames.length)

			setMinTotalTime(minTotalTime)
			setMaxTotalTime(maxTotalTime)
			setAvgTotalTime(sumTotalTime / allReceivedFrames.length)

			// LATEST FRAMES

			const latestFrames = allReceivedFrames.filter(
				(frame) => Date.now() - frame._7_renderFrameTimestamp < LATEST_DATA_DISPLAY_INTERVAL * 1000,
			)

			setLatestFrames(latestFrames)

			let maxLatestSegmentationTime = Number.MIN_SAFE_INTEGER
			let minLatestSegmentationTime = Number.MAX_SAFE_INTEGER
			let sumLatestSegmentationTime = 0
			let minLatestPropagationTime = Number.MAX_SAFE_INTEGER
			let maxLatestPropagationTime = Number.MIN_SAFE_INTEGER
			let sumLatestPropagationTime = 0
			let minLatestRenderTime = Number.MAX_SAFE_INTEGER
			let maxLatestRenderTime = Number.MIN_SAFE_INTEGER
			let sumLatestRenderTime = 0
			let minLatestTotalTime = Number.MAX_SAFE_INTEGER
			let maxLatestTotalTime = Number.MIN_SAFE_INTEGER
			let sumLatestTotalTime = 0
			latestFrames.forEach((frame) => {
				const frameSegmentationTime = frame._2_segmentationTime
				if (frameSegmentationTime < minLatestSegmentationTime) {
					minLatestSegmentationTime = frameSegmentationTime
				}
				if (frameSegmentationTime > maxLatestSegmentationTime) {
					maxLatestSegmentationTime = frameSegmentationTime
				}
				if (frameSegmentationTime) {
					sumLatestSegmentationTime += frameSegmentationTime
				}

				const framePropagationTime = frame._4_propagationTime
				if (framePropagationTime < minLatestPropagationTime) {
					minLatestPropagationTime = framePropagationTime
				}
				if (framePropagationTime > maxLatestPropagationTime) {
					maxLatestPropagationTime = framePropagationTime
				}
				if (framePropagationTime) {
					sumLatestPropagationTime += framePropagationTime
				}

				const frameRenderTime = frame._6_renderFrameTime
				if (frameRenderTime < minLatestRenderTime) {
					minLatestRenderTime = frameRenderTime
				}
				if (frameRenderTime > maxLatestRenderTime) {
					maxLatestRenderTime = frameRenderTime
				}
				if (frameRenderTime) {
					sumLatestRenderTime += frameRenderTime
				}

				const frameTotalTime = frame._8_totalTime
				if (frameTotalTime < minLatestTotalTime) {
					minLatestTotalTime = frameTotalTime
				}
				if (frameTotalTime > maxLatestTotalTime) {
					maxLatestTotalTime = frameTotalTime
				}
				if (frameTotalTime) {
					sumLatestTotalTime += frameTotalTime
				}
			})

			setMinLatestSegmentationTime(minLatestSegmentationTime)
			setMaxLatestSegmentationTime(maxLatestSegmentationTime)
			setAvgLatestSegmentationTime(sumLatestSegmentationTime / latestFrames.length)

			setMinLatestPropagationTime(minLatestPropagationTime)
			setMaxLatestPropagationTime(maxLatestPropagationTime)
			setAvgLatestPropagationTime(sumLatestPropagationTime / latestFrames.length)

			setMinLatestRenderTime(minLatestRenderTime)
			setMaxLatestRenderTime(maxLatestRenderTime)
			setAvgLatestRenderTime(sumLatestRenderTime / latestFrames.length)

			setMinLatestTotalTime(minLatestTotalTime)
			setMaxLatestTotalTime(maxLatestTotalTime)
			setAvgLatestTotalTime(sumLatestTotalTime / latestFrames.length)

			// LAST FRAME

			const lastRenderedFrame = frames.findLast((frame) => frame._7_renderFrameTimestamp !== undefined)

			if (lastRenderedFrame) {
				setLastRenderedFrameSegmentationTime(lastRenderedFrame._2_segmentationTime)
				setLastRenderedFramePropagationTime(lastRenderedFrame._4_propagationTime)
				setLastRenderedFrameRenderTime(lastRenderedFrame._6_renderFrameTime)
				setLastRenderedFrameTotalTime(lastRenderedFrame._8_totalTime)
			}
		}

		retrieveData().then(setError).catch(setError)

		setStreamRunningTime(Date.now() - streamStartTime())

		const totalMillisecondsWatched = streamWatchTime() + DATA_UPDATE_RATE
		setStreamWatchTime(totalMillisecondsWatched)
		const totalSeconds = totalMillisecondsWatched / 1000

		setBitRate(parseFloat(((totalAmountRecvBytes() * 8) / totalSeconds).toFixed(2)))
		setFramesPerSecond(parseFloat((receivedFrames().length / totalSeconds).toFixed(2)))

		setBitratePlotData(bitratePlotData().concat([{ bitrate: bitRate(), timestamp: totalMillisecondsWatched }]))
	}, DATA_UPDATE_RATE)

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	createEffect(() => {
		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("localhost") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)
	})

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => {
			player.close().then(setError).catch(setError)
			clearInterval(updateDataInterval)
		})
		player.closed().then(setError).catch(setError)
	})

	const play = () => usePlayer()?.play()

	// NOTE: The canvas automatically has width/height set to the decoded video size.
	// TODO shrink it if needed via CSS
	return (
		<>
			<Fail error={error()} />

			{isRecording() && <div class="text-red-400">Recording</div>}
			<canvas ref={canvas} onClick={play} class="aspect-video w-full rounded-lg" />

			<h3>Charts</h3>

			<button onClick={() => setShowFramesPlot(!showFramesPlot())}>Toggle Frames Plot</button>
			<button onClick={() => setShowBitratePlot(!showBitratePlot())}>Toggle Bitrate Plot</button>

			{showFramesPlot() && <FramesPlot watchStartTime={streamStartWatchTime()} frames={latestFrames()} />}
			{showBitratePlot() && <BitratePlot bitrateWithTimestamp={bitratePlotData()} />}

			<h3>Meta Data</h3>
			<div class="flex">
				<div class="mr-20 flex items-center">
					<span>Stream live since: &nbsp;</span>
					<p>{createTimeString(streamRunningTime())}</p>
				</div>

				<div class="flex items-center">
					<span>Watching since: &nbsp;</span>
					<p>{createTimeString(streamWatchTime())}</p>
				</div>
			</div>

			<div class="flex">
				<div class="mr-20 flex items-center">
					<span>Total Bits Received: &nbsp;</span>
					<p>{formatNumber(totalAmountRecvBytes() * 8)}</p>
				</div>

				<div class="flex items-center">
					<span>Bitrate: &nbsp;</span>
					<p>{formatNumber(bitRate())} bps</p>
				</div>
			</div>

			<div class="flex">
				<div class="mr-20 flex items-center">
					<span>Total Frames Received: &nbsp;</span>
					<p>{receivedFrames().length}</p>
				</div>

				<div class="mr-20 flex items-center">
					<span>Percentage of Frames Received: &nbsp;</span>
					<p>{(percentageReceivedFrames() * 100).toFixed(2)}%</p>
				</div>

				<div class="flex items-center">
					<span>Frame Rate: &nbsp;</span>
					<p>{framesPerSecond()} fps</p>
				</div>
			</div>

			<div class="grid grid-cols-4 gap-5 border">
				<div class="p-5 text-center" />
				<div class="p-5 text-center">Min</div>
				<div class="p-5 text-center">Max</div>
				<div class="p-5 text-center">Avg</div>

				<div class="p-5 text-center">Segmentation Time:</div>
				<div class="p-5 text-center">{minSegmentationTime()}</div>
				<div class="p-5 text-center">{maxSegmentationTime()}</div>
				<div class="p-5 text-center">{avgSegmentationTime().toFixed(2)}</div>

				<div class="p-5 text-center">Propagation Time:</div>
				<div class="p-5 text-center">{minPropagationTime()}</div>
				<div class="p-5 text-center">{maxPropagationTime()}</div>
				<div class="p-5 text-center">{avgPropagationTime().toFixed(2)}</div>

				<div class="p-5 text-center">Render Time:</div>
				<div class="p-5 text-center">{minRenderTime()}</div>
				<div class="p-5 text-center">{maxRenderTime()}</div>
				<div class="p-5 text-center">{avgRenderTime().toFixed(2)}</div>

				<div class="p-5 text-center">Total Time:</div>
				<div class="p-5 text-center">{minTotalTime()}</div>
				<div class="p-5 text-center">{maxTotalTime()}</div>
				<div class="p-5 text-center">{avgTotalTime().toFixed(2)}</div>
			</div>

			<h3>Last {LATEST_DATA_DISPLAY_INTERVAL} Seconds</h3>

			<div class="grid grid-cols-5 gap-6 border">
				<div class="p-5 text-center" />
				<div class="p-5 text-center">Min</div>
				<div class="p-5 text-center">Max</div>
				<div class="p-5 text-center">Last</div>
				<div class="p-5 text-center">Avg</div>

				<div class="p-5 text-center">Segmentation Time:</div>
				<div class="p-5 text-center">{minLatestSegmentationTime()}</div>
				<div class="p-5 text-center">{maxLatestSegmentationTime()}</div>
				<div class="p-5 text-center">{lastRenderedFrameSegmentationTime()}</div>
				<div class="p-5 text-center">{avgLatestSegmentationTime().toFixed(2)}</div>

				<div class="p-5 text-center">Propagation Time:</div>
				<div class="p-5 text-center">{minLatestPropagationTime()}</div>
				<div class="p-5 text-center">{maxLatestPropagationTime()}</div>
				<div class="p-5 text-center">{lastRenderedFramePropagationTime()}</div>
				<div class="p-5 text-center">{avgLatestPropagationTime().toFixed(2)}</div>

				<div class="p-5 text-center">Render Time:</div>
				<div class="p-5 text-center">{minLatestRenderTime()}</div>
				<div class="p-5 text-center">{maxLatestRenderTime()}</div>
				<div class="p-5 text-center">{lastRenderedFrameRenderTime()}</div>
				<div class="p-5 text-center">{avgLatestRenderTime().toFixed(2)}</div>

				<div class="p-5 text-center">Total Time:</div>
				<div class="p-5 text-center">{minLatestTotalTime()}</div>
				<div class="p-5 text-center">{maxLatestTotalTime()}</div>
				<div class="p-5 text-center">{lastRenderedFrameTotalTime()}</div>
				<div class="p-5 text-center">{avgLatestTotalTime().toFixed(2)}</div>
			</div>

			<button class="bg-cyan-600" onClick={() => downloadFrameData(allFrames())}>
				Download data
			</button>
		</>
	)
}
