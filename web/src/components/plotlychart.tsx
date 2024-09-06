import { createEffect, onCleanup } from "solid-js"
import type { IndexedDBFramesSchema } from "@kixelated/moq/common"

interface ChartProps {
	frames: IndexedDBFramesSchema[]
	watchStartTime: number
}

const ChartComponent = (props: ChartProps) => {
	createEffect(() => {
		const numOfFrames = props.frames.length

		if (typeof window !== "undefined") {
			// Dynamically import Plotly only in the browser environment
			void import("plotly.js-dist").then((Plotly) => {
				const trace = [
					{
						x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
						y: props.frames.map((aFrame) => aFrame._2_encodingTime),
						name: "Encoding Time",
						mode: "lines",
						marker: { color: "green" },
					},
					{
						x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
						y: props.frames.map((aFrame) => aFrame._4_propagationTime),
						name: "Propagation Time",
						mode: "lines",
						marker: { color: "yellow" },
					},
					{
						x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
						y: props.frames.map((aFrame) => aFrame._6_decodingTime),
						name: "Decoding Time",
						mode: "lines",
						marker: { color: "blue" },
					},
					{
						x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
						y: props.frames.map((aFrame) => aFrame._8_totalTime),
						name: "Total Time",
						mode: "lines",
						marker: { color: "red" },
					},
				]

				const layout = {
					xaxis: {
						title: "Video Time (s)",
					},
					yaxis: {
						title: "Frame Times (ms)",
					},
					showlegend: true,
				}

				Plotly.newPlot("chart", trace, layout)

				onCleanup(() => {
					Plotly.purge("chart") // Cleanup when component unmounts
				})
			})
		}
	})

	return <div id="chart" />
}

export default ChartComponent
