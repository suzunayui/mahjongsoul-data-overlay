import process from "node:process";
import { main } from "./mjs-collect-with-overlay.js";
import { runApp } from "./app-runtime.js";

runApp(main);
