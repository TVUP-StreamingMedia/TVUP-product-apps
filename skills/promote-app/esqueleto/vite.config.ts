import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Sin `define` con claves: todo lo que se define aquí acaba en el navegador.
export default defineConfig({ plugins: [react()] });
