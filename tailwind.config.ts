import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#102A43",
        gold: "#F2C14E",
        coral: "#E76F51",
        sand: "#F7F3EA",
      },
    },
  },
  plugins: [],
};

export default config;
