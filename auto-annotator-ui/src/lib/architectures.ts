import type { Architecture } from "@/lib/api/types";

/**
 * Every trainable detector, grouped by family. Single source for the Pro
 * wizard AND Simple mode's "More options" — both modes offer the same menu
 * (Coinbase Simple/Advanced pattern: capability parity, different framing).
 */
export const ARCH_FAMILIES: {
  label: string;
  hint: string;
  archs: Architecture[];
}[] = [
  {
    label: "YOLO26",
    hint: "newest generation, NMS-free",
    archs: ["yolo26n", "yolo26s", "yolo26m", "yolo26l", "yolo26x"],
  },
  {
    label: "YOLO11",
    hint: "proven all-rounder",
    archs: ["yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x"],
  },
  {
    label: "YOLOv10",
    hint: "previous generation",
    archs: ["yolov10n", "yolov10s", "yolov10m", "yolov10l", "yolov10x"],
  },
  {
    label: "RT-DETR",
    hint: "transformer — accurate, slower",
    archs: ["rtdetr-l", "rtdetr-x"],
  },
];

export const RECOMMENDED_ARCH: Architecture = "yolo26m";
