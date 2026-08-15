import { ImageResponse } from "next/og"

export const size = {
  width: 32,
  height: 32,
}

export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        background: "#d8ff57",
        color: "#171b08",
        fontFamily: "Arial, sans-serif",
        fontSize: 10,
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      ON
    </div>,
    size,
  )
}
