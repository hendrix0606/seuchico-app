/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#071D2D",
          secondary: "#087E83",
          accent: "#38D6D2",
          background: "#F3F7F8",
          coral: "#D94F70",
          peach: "#FF9F68",
        },
      },
      borderRadius: {
        card: "24px",
      },
    },
  },
  plugins: [],
};
