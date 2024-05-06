import { createEffect } from "solid-js"
import * as Plotly from "plotly.js-dist"
import type { IndexedDBBitRateWithTimestampSchema } from "./watch"

interface ChartProps {
	bitrateWithTimestamp: IndexedDBBitRateWithTimestampSchema[]
}

const ChartComponent = (props: ChartProps) => {
	createEffect(() => {
		const trace = [
			{
				x: props.bitrateWithTimestamp.map((aValue) => aValue.timestamp / 1000),
				y: props.bitrateWithTimestamp.map((aValue) => aValue.bitrate / 1000000),
				name: "Bitrate",
				mode: "lines",
				marker: { color: "blue" },
			},
		]

		const layout = {
			xaxis: {
				title: "Time (s)",
			},
			yaxis: {
				title: "Mbps",
			},
			showlegend: true,
		}

		void Plotly.newPlot("chart", trace, layout)

		return () => Plotly.purge("chart") // Cleanup when component unmounts
	})

	return <div id="chart" />
}

export default ChartComponent
