import { createEffect } from "solid-js"
import * as Plotly from "plotly.js-dist"
import type { IndexedDBFramesSchema } from "@kixelated/moq/contribute"

interface ChartProps {
	frames: IndexedDBFramesSchema[]
	watchStartTime: number
}

const ChartComponent = (props: ChartProps) => {
	createEffect(() => {
		const trace = [
			{
				x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
				y: props.frames.map((aFrame) => aFrame._2_segmentationTime),
				name: "Segmentation Time",
				mode: "markers",
				marker: { color: "green" },
			},
			{
				x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
				y: props.frames.map((aFrame) => aFrame._4_propagationTime),
				name: "Propagation Time",
				mode: "markers",
				marker: { color: "yellow" },
			},
			{
				x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
				y: props.frames.map((aFrame) => aFrame._6_renderFrameTime),
				name: "Render time",
				mode: "markers",
				marker: { color: "blue" },
			},
			{
				x: props.frames.map((aFrame) => (aFrame._7_renderFrameTimestamp - props.watchStartTime) / 1000),
				y: props.frames.map((aFrame) => aFrame._8_totalTime),
				name: "Total time",
				mode: "markers",
				marker: { color: "red" },
			},
		]

		const layout = {
			xaxis: {
				title: "Time (s)",
			},
			yaxis: {
				title: "Frame Times",
			},
			showlegend: true,
		}

		void Plotly.newPlot("chart", trace, layout)

		return () => Plotly.purge("chart") // Cleanup when component unmounts
	})

	return <div id="chart" />
}

export default ChartComponent
