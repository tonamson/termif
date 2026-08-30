import React from "react"

export interface IconProps {
  name: string
  size?: number | string
  className?: string
  title?: string
}

export function Icon({ name, size = 16, className = "", title }: IconProps) {
  return (
    <span
      className={"icon-symbol " + (className || "")}
      style={{ fontSize: typeof size === "number" ? size + "px" : size }}
      title={title}
      aria-hidden={!title}
    >
      {name}
    </span>
  )
}
