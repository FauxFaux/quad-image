/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export function dssim_new(): number;
export function dssim_free(a: number): void;
export function dssim_create_image_rgba(a: number, b: number, c: number, d: number): number;
export function dssim_create_image_rgb(a: number, b: number, c: number, d: number): number;
export function dssim_free_image(a: number): void;
export function dssim_compare(a: number, b: number, c: number): number;
export function dssim_calloc(a: number): number;
export function dssim_free_calloc(a: number, b: number): void;
