import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        skybrand: "#38BDF8",
        navy: "#0F2742",
        canvas: "#F8FAFC",
        ink: "#172B4D",
        success: "#16A34A",
        warning: "#F59E0B",
        error: "#DC2626",
      },
    },
  },
  plugins: [],
};

export default config;
