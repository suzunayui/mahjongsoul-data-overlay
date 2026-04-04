import process from "node:process";
import { main } from "./overlay-server.js";
import { runApp } from "./app-runtime.js";

runApp(main);
