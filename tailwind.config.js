/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Stitch Academic Nexus Design Tokens
        primary: {
          DEFAULT: '#4f46e5',
          deep: '#3525cd',
          hover: '#4338ca',
          fixed: '#e2dfff',
          'fixed-dim': '#c3c0ff',
          container: '#4f46e5',
          'on-container': '#dad7ff',
        },
        secondary: {
          DEFAULT: '#0ea5e9',
          deep: '#006591',
          container: '#39b8fd',
          fixed: '#c9e6ff',
          'on-container': '#004666',
        },
        tertiary: {
          DEFAULT: '#10b981',
          deep: '#005338',
          container: '#006e4b',
          fixed: '#6ffbbe',
          'on-container': '#67f4b7',
        },
        surface: {
          DEFAULT: '#f8f9ff',
          dim: '#cbdbf5',
          bright: '#f8f9ff',
          variant: '#d3e4fe',
          container: {
            lowest: '#ffffff',
            low: '#eff4ff',
            DEFAULT: '#e5eeff',
            high: '#dce9ff',
            highest: '#d3e4fe',
          },
        },
        'on-surface': {
          DEFAULT: '#0b1c30',
          variant: '#464555',
          muted: '#64748b',
        },
        outline: {
          DEFAULT: '#777587',
          variant: '#c7c4d8',
          subtle: '#e2e8f0',
        },
        error: {
          DEFAULT: '#ef4444',
          deep: '#ba1a1a',
          container: '#ffdad6',
          'on-container': '#93000a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};

