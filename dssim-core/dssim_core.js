import * as wasm from "./dssim_core_bg.wasm";
import { __wbg_set_wasm } from "./dssim_core_bg.js";
__wbg_set_wasm(wasm);
export * from "./dssim_core_bg.js";
