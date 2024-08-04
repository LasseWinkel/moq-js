/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback"

import { IDBService } from "@kixelated/moq/common"
import { BitrateMode, type IndexedDBFramesSchema } from "@kixelated/moq/common"

/* import FramesPlot from "./frames"
import BitratePlot from "./bitrate" */

import Fail from "./fail"

import { createEffect, createSignal, For, onCleanup } from "solid-js"

import { EVALUATION_SCENARIO, GOP_DEFAULTS } from "@kixelated/moq/common/evaluationscenarios"

export interface IndexedDBBitRateWithTimestampSchema {
	bitrate: number
	timestamp: number
}

// Data update rate in milliseconds
const DATA_UPDATE_RATE = 1000

// The time interval for the latest data in seconds
const LATEST_DATA_DISPLAY_INTERVAL = 5

// Time until data download in seconds
export const DATA_DOWNLOAD_TIME = 80

// Stall event threshold in milliseconds
const STALL_EVENT_THRESHOLD = 35

// The supported rates of network packet loss
const SUPPORTED_PACKET_LOSS = [0, 1, 5, 10, 20]

// The supported additional network delays in milliseconds
const SUPPORTED_ADDITIONAL_DELAYS = [0, 20, 50, 100, 200, 500]

// The supported network bandwidth limits in Mbit/s
const SUPPORTED_BANDWIDTHS = [0.5, 1, 1.5, 2, 3, 4.5, 5, 6, 10, 20, 100]

// The created network namespaces
enum NetworkNamespaces {
	PUBLISHER = "ns-js",
	SERVER = "ns-rs",
}

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

/* // Utility function to download collected data.
function downloadSegmentData(segments: IndexedDBSegmentsSchema[]): void {
	const jsonData = JSON.stringify(segments)
	const blob = new Blob([jsonData], {
		type: "application/json",
	})

	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	const downloadName = `segmentsres${EVALUATION_SCENARIO.resolution}fps${EVALUATION_SCENARIO.frameRate}bit${
		EVALUATION_SCENARIO.bitrate / 1_000_000
	}gop(${EVALUATION_SCENARIO.gopDefault},${EVALUATION_SCENARIO.gopThresholds[0] * 100},${
		EVALUATION_SCENARIO.gopThresholds[1] * 100
	})loss${EVALUATION_SCENARIO.packetLossServerLink}delay${EVALUATION_SCENARIO.delayServerLink}bw${
		EVALUATION_SCENARIO.bandwidthConstraintServerLink / 1_000_000
	}`
	link.download = downloadName

	// Append the link to the body
	document.body.appendChild(link)

	// Programmatically click the link to trigger the download
	link.click()

	// Clean up
	document.body.removeChild(link)
} */

// Utility function to download collected data.
export function downloadFrameData(frames: IndexedDBFramesSchema[]): void {
	const jsonData = JSON.stringify(frames)
	const blob = new Blob([jsonData], {
		type: "application/json",
	})

	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	const downloadName = `res${EVALUATION_SCENARIO.resolution}fps${EVALUATION_SCENARIO.frameRate}bit${
		EVALUATION_SCENARIO.bitrate / 1_000_000
	}gop(${EVALUATION_SCENARIO.gopDefault},${EVALUATION_SCENARIO.gopThresholds[0] * 100},${
		EVALUATION_SCENARIO.gopThresholds[1] * 100
	})loss${EVALUATION_SCENARIO.packetLossServerLink}delay${EVALUATION_SCENARIO.delayServerLink}bw${
		EVALUATION_SCENARIO.bandwidthConstraintServerLink / 1_000_000
	}`
	link.download = downloadName

	// Append the link to the body
	document.body.appendChild(link)

	// Programmatically click the link to trigger the download
	link.click()

	// Clean up
	document.body.removeChild(link)
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
	// const [streamStartWatchTime, setStreamStartWatchTime] = createSignal<number>(0)
	const [totalAmountRecvBytes, setTotalAmountRecvBytes] = createSignal<number>(0)
	const [allFrames, setAllFrames] = createSignal<IndexedDBFramesSchema[]>([])
	// const [receivedFrames, setReceivedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [latestFrames, setLatestFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [lastRenderedFrame, setLastRenderedFrame] = createSignal<IndexedDBFramesSchema>()
	const [totalSkippedFrames, setTotalSkippedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [latestSkippedFrames, setLatestSkippedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [totalStallDuration, setTotalStallDuration] = createSignal<number>(0)
	const [latestStallDuration, setLatestStallDuration] = createSignal<number>(0)
	const [percentageReceivedFrames, setPercentageReceivedFrames] = createSignal<number>(0.0)

	/* const [minEncodingTime, setMinEncodingTime] = createSignal<number>(0)
	const [maxEncodingTime, setMaxEncodingTime] = createSignal<number>(0)
	const [avgEncodingTime, setAvgEncodingTime] = createSignal<number>(0.0)
	const [minPropagationTime, setMinPropagationTime] = createSignal<number>(0)
	const [maxPropagationTime, setMaxPropagationTime] = createSignal<number>(0)
	const [avgPropagationTime, setAvgPropagationTime] = createSignal<number>(0.0)
	const [minDecodingTime, setMinDecodingTime] = createSignal<number>(0)
	const [maxDecodingTime, setMaxDecodingTime] = createSignal<number>(0)
	const [avgDecodingTime, setAvgDecodingTime] = createSignal<number>(0.0)
	const [minTotalTime, setMinTotalTime] = createSignal<number>(0)
	const [maxTotalTime, setMaxTotalTime] = createSignal<number>(0)
	const [avgTotalTime, setAvgTotalTime] = createSignal<number>(0.0) */

	const [minLatestEncodingTime, setMinLatestEncodingTime] = createSignal<number>(0)
	const [maxLatestEncodingTime, setMaxLatestEncodingTime] = createSignal<number>(0)
	const [avgLatestEncodingTime, setAvgLatestEncodingTime] = createSignal<number>(0.0)
	const [minLatestPropagationTime, setMinLatestPropagationTime] = createSignal<number>(0)
	const [maxLatestPropagationTime, setMaxLatestPropagationTime] = createSignal<number>(0)
	const [avgLatestPropagationTime, setAvgLatestPropagationTime] = createSignal<number>(0.0)
	const [minLatestDecodingTime, setMinLatestDecodingTime] = createSignal<number>(0)
	const [maxLatestDecodingTime, setMaxLatestDecodingTime] = createSignal<number>(0)
	const [avgLatestDecodingTime, setAvgLatestDecodingTime] = createSignal<number>(0.0)
	const [minLatestTotalTime, setMinLatestTotalTime] = createSignal<number>(0)
	const [maxLatestTotalTime, setMaxLatestTotalTime] = createSignal<number>(0)
	const [avgLatestTotalTime, setAvgLatestTotalTime] = createSignal<number>(0.0)

	const [lastRenderedFrameEncodingTime, setLastRenderedFrameEncodingTime] = createSignal<number>(0)
	const [lastRenderedFramePropagationTime, setLastRenderedFramePropagationTime] = createSignal<number>(0)
	const [lastRenderedFrameDecodingTime, setLastRenderedFrameDecodingTime] = createSignal<number>(0)
	const [lastRenderedFrameTotalTime, setLastRenderedFrameTotalTime] = createSignal<number>(0)

	/* const [showFramesPlot, setShowFramesPlot] = createSignal<boolean>(false)
	const [showBitratePlot, setShowBitratePlot] = createSignal<boolean>(false)

	const [bitratePlotData, setBitratePlotData] = createSignal<IndexedDBBitRateWithTimestampSchema[]>([]) */
	const [bitRate, setBitRate] = createSignal<number>(0.0)
	const [framesPerSecond, setFramesPerSecond] = createSignal<number>(0.0)

	const [keyFrameInterval, setKeyFrameInterval] = createSignal<number>(EVALUATION_SCENARIO.gopDefault)
	const [gop1sThreshold, setGop1sThreshold] = createSignal<number>(EVALUATION_SCENARIO.gopThresholds[0] * 100)
	const [gop0_5sThreshold, setGop0_5sThreshold] = createSignal<number>(EVALUATION_SCENARIO.gopThresholds[1] * 100)
	const [constantGopSize, setConstantGopSize] = createSignal<boolean>(false)
	const [packetLossPublisher, setPacketLossPublisher] = createSignal<number>(0)
	const [delayPublisher, setDelayPublisher] = createSignal<number>(0)
	const [bandwidthLimitPublisher, setBandwidthLimitPublisher] = createSignal<number>(
		SUPPORTED_BANDWIDTHS[SUPPORTED_BANDWIDTHS.length - 1],
	)
	const [packetLossServer, setPacketLossServer] = createSignal<number>(0)
	const [delayServer, setDelayServer] = createSignal<number>(0)
	const [bandwidthLimitServer, setBandwidthLimitServer] = createSignal<number>(
		SUPPORTED_BANDWIDTHS[SUPPORTED_BANDWIDTHS.length - 1],
	)
	const [bitrateMode, setBitrateMode] = createSignal<BitrateMode>(BitrateMode.CONSTANT)
	const [targetBitrate, setTargetBitrate] = createSignal<number>(EVALUATION_SCENARIO.bitrate)

	// const [isRecording, setIsRecording] = createSignal<boolean>(false)

	// Define a function to update the data at regular times
	const updateDataInterval = setInterval(() => {
		// Function to retrieve data from the IndexedDB
		const retrieveData = async () => {
			if (streamStartTime() === 0) {
				setStreamStartTime(await IDBService.getStreamStartTime())
				// setStreamStartWatchTime(Date.now())

				// Record the received video
				/* setIsRecording(true)
				const stream = canvas.captureStream()
				console.log(stream)

				const recordedBlobs: BlobPart[] = []
				const mediaRecorder = new MediaRecorder(stream, {
					videoBitsPerSecond: 2_000_000,
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
					const blob = new Blob(recordedBlobs, { type: "video/webm" })
					const url = URL.createObjectURL(blob)
					const a = document.createElement("a")
					a.href = url
					a.download = "received_video.webm"
					a.click()
					URL.revokeObjectURL(url)
				}

				setTimeout(() => {
					mediaRecorder.stop()
				}, 5000) */

				setTimeout(() => {
					// mediaRecorder.stop()
					downloadFrameData(allFrames())
					// downloadSegmentData(await retrieveSegmentsFromIndexedDB())
					// clearInterval(updateDataInterval)
				}, DATA_DOWNLOAD_TIME * 1000)

				/* 	setTimeout(() => {
					setDelayServer(200)
					setBandwidthLimitServer(100)
					setPacketLossServer(0)
					throttleConnection(NetworkNamespaces.SERVER)
				}, 35_000)

				setTimeout(() => {
					setDelayServer(50)
					setBandwidthLimitServer(100)
					setPacketLossServer(0)
					throttleConnection(NetworkNamespaces.SERVER)
				}, 55_000) */
			}

			const timeOfDataRetrieval = Date.now()
			const frames = await IDBService.retrieveFramesFromIndexedDB()

			// Ignore first few frames since none of these frames will acutally be received
			// const firstReceivedFrameIndex =
			// 	frames.slice(60).findIndex((frame) => frame._5_receiveMp4FrameTimestamp !== undefined) + 60
			// console.log("FIRST_RECEVIED_FRAME_INDEX", firstReceivedFrameIndex)

			const allReceivedFrames = frames.filter((frame) => frame._5_receiveMp4FrameTimestamp !== undefined)
			const allSkippedFrames = frames.filter((frame) => frame._5_receiveMp4FrameTimestamp === undefined)
			const allRenderedFrames = frames.filter((frame) => frame._7_renderFrameTimestamp !== undefined)

			// ALL FRAMES

			setAllFrames(frames)
			// setReceivedFrames(allReceivedFrames)
			setTotalSkippedFrames(allSkippedFrames)

			let totalSumRenderDifference = 0

			for (let i = 0; i < allRenderedFrames.length - 1; i++) {
				const currentTimestamp = allRenderedFrames[i]._7_renderFrameTimestamp
				const nextTimestamp = allRenderedFrames[i + 1]._7_renderFrameTimestamp
				const difference = nextTimestamp - currentTimestamp

				if (difference > STALL_EVENT_THRESHOLD) {
					totalSumRenderDifference += difference - STALL_EVENT_THRESHOLD
				}
			}

			setTotalStallDuration(totalSumRenderDifference)

			/* let minEncodingTime = Number.MAX_SAFE_INTEGER
			let maxEncodingTime = Number.MIN_SAFE_INTEGER
			let sumEncodingTime = 0
			let minPropagationTime = Number.MAX_SAFE_INTEGER
			let maxPropagationTime = Number.MIN_SAFE_INTEGER
			let sumPropagationTime = 0
			let minDecodingTime = Number.MAX_SAFE_INTEGER
			let maxDecodingTime = Number.MIN_SAFE_INTEGER
			let sumDecodingTime = 0
			let minTotalTime = Number.MAX_SAFE_INTEGER
			let maxTotalTime = Number.MIN_SAFE_INTEGER
			let sumTotalTime = 0
			allReceivedFrames.forEach((frame) => {
				const frameEncodingTime = frame._2_encodingTime
				if (frameEncodingTime < minEncodingTime) {
					minEncodingTime = frameEncodingTime
				}
				if (frameEncodingTime > maxEncodingTime) {
					maxEncodingTime = frameEncodingTime
				}
				if (frameEncodingTime) {
					sumEncodingTime += frameEncodingTime
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

				const frameDecodingTime = frame._6_decodingTime
				if (frameDecodingTime < minDecodingTime) {
					minDecodingTime = frameDecodingTime
				}
				if (frameDecodingTime > maxDecodingTime) {
					maxDecodingTime = frameDecodingTime
				}
				if (frameDecodingTime) {
					sumDecodingTime += frameDecodingTime
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


			setMinEncodingTime(minEncodingTime)
			setMaxEncodingTime(maxEncodingTime)
			setAvgEncodingTime(sumEncodingTime / allReceivedFrames.length)

			setMinPropagationTime(minPropagationTime)
			setMaxPropagationTime(maxPropagationTime)
			setAvgPropagationTime(sumPropagationTime / allReceivedFrames.length)

			setMinDecodingTime(minDecodingTime)
			setMaxDecodingTime(maxDecodingTime)
			setAvgDecodingTime(sumDecodingTime / allReceivedFrames.length)

			setMinTotalTime(minTotalTime)
			setMaxTotalTime(maxTotalTime)
			setAvgTotalTime(sumTotalTime / allReceivedFrames.length) */

			// LATEST FRAMES

			const latestFrames = frames.filter(
				(frame) => timeOfDataRetrieval - frame._3_segmentationTimestamp <= LATEST_DATA_DISPLAY_INTERVAL * 1000,
			)
			const latestReceivedFrames = allReceivedFrames.filter(
				(frame) =>
					timeOfDataRetrieval - frame._5_receiveMp4FrameTimestamp <= LATEST_DATA_DISPLAY_INTERVAL * 1000,
			)
			const latestSkippedFrames = allSkippedFrames.filter(
				(frame) => timeOfDataRetrieval - frame._3_segmentationTimestamp <= LATEST_DATA_DISPLAY_INTERVAL * 1000,
			)
			const latestRenderedFrames = allRenderedFrames.filter(
				(frame) => timeOfDataRetrieval - frame._7_renderFrameTimestamp <= LATEST_DATA_DISPLAY_INTERVAL * 1000,
			)

			setLatestFrames(latestFrames)
			setLatestSkippedFrames(latestSkippedFrames)

			setPercentageReceivedFrames(Math.min(latestReceivedFrames.length / latestFrames.length, 1))

			let latestSumRenderDifference = 0

			for (let i = 0; i < latestRenderedFrames.length - 1; i++) {
				const currentTimestamp = latestRenderedFrames[i]._7_renderFrameTimestamp
				const nextTimestamp = latestRenderedFrames[i + 1]._7_renderFrameTimestamp
				const difference = nextTimestamp - currentTimestamp

				if (difference > STALL_EVENT_THRESHOLD) {
					latestSumRenderDifference += difference - STALL_EVENT_THRESHOLD
				}
			}

			setLatestStallDuration(latestSumRenderDifference)

			let totalAmountRecvBytes = 0

			let maxLatestEncodingTime = Number.MIN_SAFE_INTEGER
			let minLatestEncodingTime = Number.MAX_SAFE_INTEGER
			let sumLatestEncodingTime = 0
			let minLatestPropagationTime = Number.MAX_SAFE_INTEGER
			let maxLatestPropagationTime = Number.MIN_SAFE_INTEGER
			let sumLatestPropagationTime = 0
			let minLatestDecodingTime = Number.MAX_SAFE_INTEGER
			let maxLatestDecodingTime = Number.MIN_SAFE_INTEGER
			let sumLatestDecodingTime = 0
			let minLatestTotalTime = Number.MAX_SAFE_INTEGER
			let maxLatestTotalTime = Number.MIN_SAFE_INTEGER
			let sumLatestTotalTime = 0
			latestFrames.forEach((frame) => {
				if (frame._5_receiveMp4FrameTimestamp) {
					totalAmountRecvBytes += frame._14_receivedBytes
				}

				const frameEncodingTime = frame._2_encodingTime
				if (frameEncodingTime < minLatestEncodingTime) {
					minLatestEncodingTime = frameEncodingTime
				}
				if (frameEncodingTime > maxLatestEncodingTime) {
					maxLatestEncodingTime = frameEncodingTime
				}
				if (frameEncodingTime) {
					sumLatestEncodingTime += frameEncodingTime
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

				const frameDecodingTime = frame._6_decodingTime
				if (frameDecodingTime < minLatestDecodingTime) {
					minLatestDecodingTime = frameDecodingTime
				}
				if (frameDecodingTime > maxLatestDecodingTime) {
					maxLatestDecodingTime = frameDecodingTime
				}
				if (frameDecodingTime) {
					sumLatestDecodingTime += frameDecodingTime
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

			setTotalAmountRecvBytes(totalAmountRecvBytes)

			setMinLatestEncodingTime(minLatestEncodingTime)
			setMaxLatestEncodingTime(maxLatestEncodingTime)
			setAvgLatestEncodingTime(sumLatestEncodingTime / latestFrames.length)

			setMinLatestPropagationTime(minLatestPropagationTime)
			setMaxLatestPropagationTime(maxLatestPropagationTime)
			setAvgLatestPropagationTime(sumLatestPropagationTime / latestFrames.length)

			setMinLatestDecodingTime(minLatestDecodingTime)
			setMaxLatestDecodingTime(maxLatestDecodingTime)
			setAvgLatestDecodingTime(sumLatestDecodingTime / latestFrames.length)

			setMinLatestTotalTime(minLatestTotalTime)
			setMaxLatestTotalTime(maxLatestTotalTime)
			setAvgLatestTotalTime(sumLatestTotalTime / latestFrames.length)

			// LAST FRAME

			const lastRenderedFrame = frames.findLast((frame) => frame._7_renderFrameTimestamp !== undefined)

			if (lastRenderedFrame) {
				setLastRenderedFrame(lastRenderedFrame)
				setLastRenderedFrameEncodingTime(lastRenderedFrame._2_encodingTime)
				setLastRenderedFramePropagationTime(lastRenderedFrame._4_propagationTime)
				setLastRenderedFrameDecodingTime(lastRenderedFrame._6_decodingTime)
				setLastRenderedFrameTotalTime(lastRenderedFrame._8_totalTime)
			}
		}

		retrieveData().then(setError).catch(setError)

		setStreamRunningTime(Date.now() - streamStartTime())

		const totalMillisecondsWatched = streamWatchTime() + DATA_UPDATE_RATE
		setStreamWatchTime(totalMillisecondsWatched)
		// const totalSeconds = totalMillisecondsWatched / 1000

		setBitRate(parseFloat(((totalAmountRecvBytes() * 8) / LATEST_DATA_DISPLAY_INTERVAL).toFixed(2)))
		setFramesPerSecond(parseFloat((latestFrames().length / LATEST_DATA_DISPLAY_INTERVAL).toFixed(2)))

		if (!constantGopSize()) {
			// Adjust key frame interval if number of received frames changes
			let newKeyFrameInterval: number
			if (percentageReceivedFrames() < gop1sThreshold() / 100) {
				newKeyFrameInterval = 1

				if (percentageReceivedFrames() < gop0_5sThreshold() / 100) {
					newKeyFrameInterval = 0.5
				}
			} else {
				newKeyFrameInterval = EVALUATION_SCENARIO.gopDefault
			}
			if (newKeyFrameInterval !== keyFrameInterval()) {
				setKeyFrameInterval(newKeyFrameInterval)
				IDBService.adjustKeyFrameIntervalSizeInIndexedDB(keyFrameInterval())
			}
		}

		// setBitratePlotData(bitratePlotData().concat([{ bitrate: bitRate(), timestamp: totalMillisecondsWatched }]))
	}, DATA_UPDATE_RATE)

	const throttleConnection = (networkNamespace: NetworkNamespaces) => {
		if (networkNamespace === NetworkNamespaces.PUBLISHER) {
			usePlayer()?.throttle(
				packetLossPublisher(),
				delayPublisher(),
				bandwidthLimitPublisher().toString(),
				networkNamespace,
			)
		} else if (networkNamespace === NetworkNamespaces.SERVER) {
			usePlayer()?.throttle(
				packetLossServer(),
				delayServer(),
				bandwidthLimitServer().toString(),
				networkNamespace,
			)
		}
	}

	const tc_reset = (networkNamespace: NetworkNamespaces) => {
		usePlayer()?.tc_reset(networkNamespace)
	}

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	createEffect(() => {
		IDBService.initIDBService()

		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("12.0.0.1") ? `https://${server}/fingerprint` : undefined

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
		<div class="flex">
			<div class="w-1/2">
				<Fail error={error()} />

				{/* {isRecording() && <div class="text-red-400">Recording</div>} */}
				<span>
					{lastRenderedFrame()?._17_width} x {lastRenderedFrame()?._18_height}
				</span>
				<canvas ref={canvas} onClick={play} class="aspect-video w-3/4 rounded-lg" />

				{/* {<h3>Charts</h3>}

				<button onClick={() => setShowFramesPlot(!showFramesPlot())}>Toggle Frames Plot</button>
				<button onClick={() => setShowBitratePlot(!showBitratePlot())}>Toggle Bitrate Plot</button>

				{showFramesPlot() && <FramesPlot watchStartTime={streamStartWatchTime()} frames={latestFrames()} />}
				{showBitratePlot() && <BitratePlot bitrateWithTimestamp={bitratePlotData()} />}

				*/}

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
						<span>Total Frames Skipped: &nbsp;</span>
						<p>{totalSkippedFrames().length}</p>
					</div>
					<div class="flex items-center">
						<span>Total Stall Duration: &nbsp;</span>
						<p>{(totalStallDuration() / 1000).toFixed(2)}s</p>
					</div>
				</div>

				<div class="w-full">
					<div class="flex items-center">
						<span>Key Frame Interval (s): &nbsp;</span>
						<select
							class="m-3 w-1/3"
							onChange={(event) => {
								setConstantGopSize(true)
								setKeyFrameInterval(parseFloat(event.target.value))
								IDBService.adjustKeyFrameIntervalSizeInIndexedDB(parseFloat(event.target.value))
							}}
						>
							<For each={GOP_DEFAULTS}>
								{(value) => (
									<option value={value} selected={value === keyFrameInterval()}>
										{value}
									</option>
								)}
							</For>
						</select>
					</div>

					<div class="flex items-center">
						GoP size 1s Received Frames:
						<input
							class="m-3 w-1/3"
							type="range"
							min="15"
							max="95"
							value={gop1sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop1sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop1sThreshold()}%</div>
					</div>

					<div class="flex items-center">
						GoP size 0.5s Received Frames:
						<input
							class="m-3 w-1/3"
							type="range"
							min="10"
							max="90"
							value={gop0_5sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop0_5sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop0_5sThreshold()}%</div>
					</div>

					<div class="flex items-center">
						<div class="mr-5 w-1/2 border p-2">
							<h3>Publisher Network</h3>
							<div class="flex items-center">
								Packet Loss (%):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setPacketLossPublisher(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={SUPPORTED_PACKET_LOSS}>
										{(value) => (
											<option value={value} selected={value === packetLossPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Network Delay (ms):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setDelayPublisher(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={SUPPORTED_ADDITIONAL_DELAYS}>
										{(value) => (
											<option value={value} selected={value === delayPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Bandwidth Limit (Mbit/s):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setBandwidthLimitPublisher(parseFloat(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={SUPPORTED_BANDWIDTHS}>
										{(value) => (
											<option value={value} selected={value === bandwidthLimitPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<button
								class="m-3 bg-cyan-600 hover:bg-cyan-800"
								onClick={() => {
									tc_reset(NetworkNamespaces.PUBLISHER)
									setPacketLossPublisher(0)
									setDelayPublisher(0)
									setBandwidthLimitPublisher(SUPPORTED_BANDWIDTHS[SUPPORTED_BANDWIDTHS.length - 1])
								}}
							>
								Reset tc rules
							</button>
						</div>

						<div class="w-1/2 border p-2">
							<h3>Server Network</h3>
							<div class="flex items-center">
								Packet Loss (%):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setPacketLossServer(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={SUPPORTED_PACKET_LOSS}>
										{(value) => (
											<option value={value} selected={value === packetLossServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Network Delay (ms):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setDelayServer(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={SUPPORTED_ADDITIONAL_DELAYS}>
										{(value) => (
											<option value={value} selected={value === delayServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Bandwidth Limit (Mbit/s):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setBandwidthLimitServer(parseFloat(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={SUPPORTED_BANDWIDTHS}>
										{(value) => (
											<option value={value} selected={value === bandwidthLimitServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<button
								class="m-3 bg-cyan-600 hover:bg-cyan-800"
								onClick={() => {
									tc_reset(NetworkNamespaces.SERVER)
									setPacketLossServer(0)
									setDelayServer(0)
									setBandwidthLimitServer(SUPPORTED_BANDWIDTHS[SUPPORTED_BANDWIDTHS.length - 1])
								}}
							>
								Reset tc rules
							</button>
						</div>
					</div>
				</div>

				{/* <div class="flex w-1/2 flex-col items-center justify-center">
					<button
						class="m-3 bg-cyan-600 hover:bg-cyan-800"
						// eslint-disable-next-line @typescript-eslint/no-misused-promises
						onClick={async () => downloadFrameData(await retrieveFramesFromIndexedDB())}
					>
						Download data
					</button>
				</div> */}
			</div>

			{/*

			<div class="grid grid-cols-4 gap-5 border">
				<div class="p-5 text-center" />
				<div class="p-5 text-center">Min</div>
				<div class="p-5 text-center">Max</div>
				<div class="p-5 text-center">Avg</div>

				<div class="p-5 text-center">Encoding Time:</div>
				<div class="p-5 text-center">{minEncodingTime()}</div>
				<div class="p-5 text-center">{maxEncodingTime()}</div>
				<div class="p-5 text-center">{avgEncodingTime().toFixed(2)}</div>

				<div class="p-5 text-center">Propagation Time:</div>
				<div class="p-5 text-center">{minPropagationTime()}</div>
				<div class="p-5 text-center">{maxPropagationTime()}</div>
				<div class="p-5 text-center">{avgPropagationTime().toFixed(2)}</div>

				<div class="p-5 text-center">Render Time:</div>
				<div class="p-5 text-center">{minDecodingTime()}</div>
				<div class="p-5 text-center">{maxDecodingTime()}</div>
				<div class="p-5 text-center">{avgDecodingTime().toFixed(2)}</div>

				<div class="p-5 text-center">Total Time:</div>
				<div class="p-5 text-center">{minTotalTime()}</div>
				<div class="p-5 text-center">{maxTotalTime()}</div>
				<div class="p-5 text-center">{avgTotalTime().toFixed(2)}</div>
			</div>
			*/}

			<div class="flex w-1/2 flex-col items-center">
				<h3>Meta Data of Last {LATEST_DATA_DISPLAY_INTERVAL} Seconds</h3>

				<div class="grid grid-cols-5 gap-6 border">
					<div class="p-4 text-center" />
					<div class="p-4 text-center">Min</div>
					<div class="p-4 text-center">Max</div>
					<div class="p-4 text-center">Last</div>
					<div class="p-4 text-center">Avg</div>

					<div class="p-4 text-center">Encoding Time:</div>
					<div class="p-4 text-center">{minLatestEncodingTime()} ms</div>
					<div class="p-4 text-center">{maxLatestEncodingTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFrameEncodingTime()} ms</div>
					<div class="p-4 text-center">{avgLatestEncodingTime().toFixed(2)} ms</div>

					<div class="p-4 text-center">Propagation Time:</div>
					<div class="p-4 text-center">{minLatestPropagationTime()} ms</div>
					<div class="p-4 text-center">{maxLatestPropagationTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFramePropagationTime()} ms</div>
					<div class="p-4 text-center">{avgLatestPropagationTime().toFixed(2)} ms</div>

					<div class="p-4 text-center">Decoding Time:</div>
					<div class="p-4 text-center">{minLatestDecodingTime()} ms</div>
					<div class="p-4 text-center">{maxLatestDecodingTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFrameDecodingTime()} ms</div>
					<div class="p-4 text-center">{avgLatestDecodingTime().toFixed(2)} ms</div>

					<div class="p-4 text-center">Total Time:</div>
					<div class="p-4 text-center">{minLatestTotalTime()} ms</div>
					<div class="p-4 text-center">{maxLatestTotalTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFrameTotalTime()} ms</div>
					<div class="p-4 text-center">{avgLatestTotalTime().toFixed(2)} ms</div>
				</div>

				<div class="flex">
					{/* <div class="mr-20 flex items-center">
						<span>Bits Received: &nbsp;</span>
						<p>{formatNumber(totalAmountRecvBytes() * 8)}</p>
					</div> */}

					<div class="mr-20 flex items-center">
						<span>Bitrate: &nbsp;</span>
						<p>{formatNumber(bitRate())} bps</p>
					</div>

					<div class="flex items-center">
						<span>Frame Rate: &nbsp;</span>
						<p>{framesPerSecond()} fps</p>
					</div>
				</div>

				<div class="flex">
					{/* <div class="mr-14 flex items-center">
						<span>Total Frames Received: &nbsp;</span>
						<p>{receivedFrames().length}</p>
					</div> */}

					<div class="mr-14 flex items-center">
						<span>Percentage of Frames Received: &nbsp;</span>
						<p>{(percentageReceivedFrames() * 100).toFixed(2)}%</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Latest Frames Skipped: &nbsp;</span>
						<p>{latestSkippedFrames().length}</p>
					</div>
					<div class="flex items-center">
						<span>Latest Stall Duration: &nbsp;</span>
						<p>{(latestStallDuration() / 1000).toFixed(2)}s</p>
					</div>
				</div>

				<div class="flex items-center">
					<span>Bitrate Mode: &nbsp;</span>
					<select
						class="m-3"
						onChange={(event) => {
							setBitrateMode(event.target.value as BitrateMode)
							IDBService.changeBitrateMode(event.target.value as BitrateMode)
						}}
					>
						<For each={Object.values(BitrateMode)}>
							{(value) => (
								<option value={value} selected={value === bitrateMode()}>
									{value}
								</option>
							)}
						</For>
					</select>
				</div>

				<div class="flex items-center">
					Bitrate: &nbsp;<span class="text-slate-400">{(targetBitrate() / 1_000_000).toFixed(1)} Mb/s</span>
					<input
						disabled={bitrateMode() === BitrateMode.CONSTANT}
						class="m-3"
						type="range"
						min={500_000}
						max={20_000_000}
						value={targetBitrate()}
						onChange={(event) => {
							const value = parseInt(event.target.value, 10)
							setTargetBitrate(value)
							IDBService.changeBitrate(value)
						}}
					/>
				</div>
			</div>
		</div>
	)
}
