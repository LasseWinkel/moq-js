/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback"

import { IDBService } from "@kixelated/moq/common"
import { BitrateMode, type IndexedDBFramesSchema } from "@kixelated/moq/common"

import Fail from "./fail"

import { createEffect, createSignal, For, onCleanup } from "solid-js"

import Plot from "./plotlychart"

import {
	BANDWIDTH_CONSTRAINTS_SERVER_LINK,
	DELAYS_SERVER_LINK,
	EVALUATION_SCENARIO,
	GOP_DEFAULTS,
	PACKET_LOSS_SERVER_LINK,
} from "@kixelated/moq/common/evaluationscenarios"

import config from "../../../config.json"

// Data update rate in milliseconds
const DATA_UPDATE_RATE = 1000

// The time interval for the latest data in seconds
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const LATEST_DATA_DISPLAY_INTERVAL = config.timeIntervalOfLatestDataInSeconds

// Time until data download in seconds
export const DATA_DOWNLOAD_TIME = 80

// Stall event threshold in milliseconds
const STALL_EVENT_THRESHOLD = 34

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

/* // Utility function to download collected segment data.
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

	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
} */

// Utility function to download collected frame data.
export function downloadFrameData(publisherData: boolean, frames: IndexedDBFramesSchema[]): void {
	const jsonData = JSON.stringify(frames)
	const blob = new Blob([jsonData], {
		type: "application/json",
	})

	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	let downloadName = `res${EVALUATION_SCENARIO.resolution}fps${EVALUATION_SCENARIO.frameRate}bit${
		EVALUATION_SCENARIO.bitrate / 1_000_000
	}gop(${EVALUATION_SCENARIO.gopDefault},${EVALUATION_SCENARIO.gopThresholds[0] * 100},${
		EVALUATION_SCENARIO.gopThresholds[1] * 100
	})loss${EVALUATION_SCENARIO.packetLossServerLink}delay${EVALUATION_SCENARIO.delayServerLink}bw${
		EVALUATION_SCENARIO.bandwidthConstraintServerLink
	}`
	if (publisherData) {
		downloadName = "publisher" + downloadName
	}
	link.download = downloadName

	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
}

export default function Watch(props: { name: string }) {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? `${config.serverIpAddress}:${config.serverPort}`

	const [error, setError] = createSignal<Error | undefined>()

	// Various dynamic meta data to be displayed next to the video
	const [streamStartTime, setStreamStartTime] = createSignal<number>(0)
	const [streamRunningTime, setStreamRunningTime] = createSignal<number>(0)
	const [streamWatchTime, setStreamWatchTime] = createSignal<number>(0)
	const [totalAmountRecvBytes, setTotalAmountRecvBytes] = createSignal<number>(0)
	const [allFrames, setAllFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [latestFrames, setLatestFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [lastRenderedFrame, setLastRenderedFrame] = createSignal<IndexedDBFramesSchema>()
	const [totalSkippedFrames, setTotalSkippedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [latestSkippedFrames, setLatestSkippedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [totalStallDuration, setTotalStallDuration] = createSignal<number>(0)
	const [latestStallDuration, setLatestStallDuration] = createSignal<number>(0)
	const [percentageReceivedFrames, setPercentageReceivedFrames] = createSignal<number>(0.0)

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

	const [bitRate, setBitRate] = createSignal<number>(0.0)
	const [framesPerSecond, setFramesPerSecond] = createSignal<number>(0.0)

	const [keyFrameInterval, setKeyFrameInterval] = createSignal<number>(EVALUATION_SCENARIO.gopDefault)
	const [gop1sThreshold, setGop1sThreshold] = createSignal<number>(EVALUATION_SCENARIO.gopThresholds[0] * 100)
	const [gop0_5sThreshold, setGop0_5sThreshold] = createSignal<number>(EVALUATION_SCENARIO.gopThresholds[1] * 100)
	const [constantGopSize, setConstantGopSize] = createSignal<boolean>(false)
	const [packetLossPublisher, setPacketLossPublisher] = createSignal<number>(0)
	const [delayPublisher, setDelayPublisher] = createSignal<number>(0)
	const [bandwidthLimitPublisher, setBandwidthLimitPublisher] = createSignal<number>(
		BANDWIDTH_CONSTRAINTS_SERVER_LINK[0],
	)
	const [packetLossServer, setPacketLossServer] = createSignal<number>(0)
	const [delayServer, setDelayServer] = createSignal<number>(0)
	const [bandwidthLimitServer, setBandwidthLimitServer] = createSignal<number>(BANDWIDTH_CONSTRAINTS_SERVER_LINK[0])
	const [bitrateMode, setBitrateMode] = createSignal<BitrateMode>(BitrateMode.CONSTANT)
	const [targetBitrate, setTargetBitrate] = createSignal<number>(EVALUATION_SCENARIO.bitrate)
	const [gopSize, setGopSize] = createSignal<number>(0)

	// Define a function to update the data at regular times
	const updateDataInterval = setInterval(() => {
		// Function to retrieve data from the IndexedDB
		const retrieveData = async () => {
			if (streamStartTime() === 0) {
				setStreamStartTime(await IDBService.getStreamStartTime())

				setTimeout(() => {
					if (config.allowDownloadOfSubscriberFrameDataInTheBrowser) {
						downloadFrameData(false, allFrames())
					}
					// downloadSegmentData(await retrieveSegmentsFromIndexedDB())
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

			const allReceivedFrames = frames.filter((frame) => frame._5_receiveMp4FrameTimestamp !== undefined)
			const allSkippedFrames = frames.filter((frame) => frame._5_receiveMp4FrameTimestamp === undefined)
			const allRenderedFrames = frames.filter((frame) => frame._7_renderFrameTimestamp !== undefined)

			// ALL FRAMES

			setAllFrames(frames)
			setTotalSkippedFrames(allSkippedFrames)

			let newTotalStallDuration = 0

			for (let i = 0; i < allRenderedFrames.length - 1; i++) {
				const currentTimestamp = allRenderedFrames[i]._7_renderFrameTimestamp
				const nextTimestamp = allRenderedFrames[i + 1]._7_renderFrameTimestamp
				const difference = nextTimestamp - currentTimestamp

				if (difference > STALL_EVENT_THRESHOLD) {
					newTotalStallDuration += difference - STALL_EVENT_THRESHOLD
				}
			}

			setTotalStallDuration(newTotalStallDuration)

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

			const latestKeyFrames = latestFrames.filter((aFrame) => aFrame._15_sentType === "key")
			setGopSize(
				parseFloat(
					(LATEST_DATA_DISPLAY_INTERVAL / (latestKeyFrames.length > 0 ? latestKeyFrames.length : 1)).toFixed(
						2,
					),
				),
			)

			setLatestFrames(latestFrames)
			setLatestSkippedFrames(latestSkippedFrames)

			setPercentageReceivedFrames(Math.min(latestReceivedFrames.length / latestFrames.length, 1))

			let newLatestStallDuration = 0

			for (let i = 0; i < latestRenderedFrames.length - 1; i++) {
				const currentTimestamp = latestRenderedFrames[i]._7_renderFrameTimestamp
				const nextTimestamp = latestRenderedFrames[i + 1]._7_renderFrameTimestamp
				const difference = nextTimestamp - currentTimestamp

				if (difference > STALL_EVENT_THRESHOLD) {
					newLatestStallDuration += difference - STALL_EVENT_THRESHOLD
				}
			}

			setLatestStallDuration(newLatestStallDuration)

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

			const bitrateSettings = await IDBService.retrieveBitrateSettings()
			setBitrateMode(bitrateSettings.bitrateMode)
			setTargetBitrate(bitrateSettings.bitrate)
			const targetGopSize = await IDBService.retrieveKeyFrameIntervalSize()
			if (targetGopSize) {
				setKeyFrameInterval(targetGopSize)
			}
		}

		retrieveData().then(setError).catch(setError)

		setStreamRunningTime(Date.now() - streamStartTime())

		const totalMillisecondsWatched = streamWatchTime() + DATA_UPDATE_RATE
		setStreamWatchTime(totalMillisecondsWatched)

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
		const fingerprint = server.startsWith(config.serverIpAddress) ? `https://${server}/fingerprint` : undefined

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

				<span>
					{lastRenderedFrame()?._17_width} x {lastRenderedFrame()?._18_height}
				</span>
				<canvas ref={canvas} onClick={play} class={`aspect-video ${config.subscriberVideoWidth} rounded-lg`} />

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Stream Live For: &nbsp;</span>
						<p>{createTimeString(streamRunningTime())}</p>
					</div>

					<div class="flex items-center">
						<span>Watching For: &nbsp;</span>
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
						<p>{(totalStallDuration() / 1000).toFixed(3)}s</p>
					</div>
				</div>

				<div class="w-full">
					<div class="flex items-center">
						<span>Target GoP Size (s): &nbsp;</span>
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
						GoP 1s FDR Threshold:
						<input
							class="m-3 w-1/3"
							type="range"
							min="15"
							max="99"
							disabled={constantGopSize()}
							value={gop1sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop1sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop1sThreshold()}%</div>
					</div>

					<div class="flex items-center">
						GoP 0.5s FDR Threshold:
						<input
							class="m-3 w-1/3"
							type="range"
							min="10"
							max="95"
							disabled={constantGopSize()}
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
									<For each={PACKET_LOSS_SERVER_LINK}>
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
									<For each={DELAYS_SERVER_LINK}>
										{(value) => (
											<option value={value} selected={value === delayPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Bandwidth Limit (Mbps):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setBandwidthLimitPublisher(parseFloat(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={BANDWIDTH_CONSTRAINTS_SERVER_LINK}>
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
									setBandwidthLimitPublisher(BANDWIDTH_CONSTRAINTS_SERVER_LINK[0])
								}}
							>
								Reset tc Rules
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
									<For each={PACKET_LOSS_SERVER_LINK}>
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
									<For each={DELAYS_SERVER_LINK}>
										{(value) => (
											<option value={value} selected={value === delayServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Bandwidth Limit (Mbps):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setBandwidthLimitServer(parseFloat(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={BANDWIDTH_CONSTRAINTS_SERVER_LINK}>
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
									setBandwidthLimitServer(BANDWIDTH_CONSTRAINTS_SERVER_LINK[0])
								}}
							>
								Reset tc Rules
							</button>
						</div>
					</div>
				</div>

				{/* <div class="flex w-1/2 flex-col items-center justify-center">
					<button
						class="m-3 bg-cyan-600 hover:bg-cyan-800"
						// eslint-disable-next-line @typescript-eslint/no-misused-promises
						onClick={async () => downloadFrameData(false, await IDBService.retrieveFramesFromIndexedDB())}
					>
						Download data
					</button>
				</div> */}
			</div>

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

				{config.displayLocalSubscriberFrameTimesGraph && (
					<Plot frames={latestFrames()} watchStartTime={streamStartTime()} />
				)}

				<div class="flex">
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
					<div class="mr-14 flex items-center">
						<span>Frame Delivery Rate: &nbsp;</span>
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
						<p>{(latestStallDuration() / 1000).toFixed(3)}s</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>GoP Size: &nbsp;</span>
						<p>{gopSize().toFixed(2)}</p>
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
					Target Bitrate:
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
					<span class="text-slate-400">{(targetBitrate() / 1_000_000).toFixed(1)} Mbps</span>
				</div>
			</div>
		</div>
	)
}
