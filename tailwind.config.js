/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Strict Brand Palette
        navy: '#30280D',
        teal: '#243607',
        brand: {
          primary: '#243607',
          secondary: '#91696E',
          dark: '#30280D',
          neutral: '#BBBEA7',
        },
        primary: {
          DEFAULT: '#243607',
          dark: '#182404',
          light: '#354e0c',
          soft: 'rgba(36, 54, 7, 0.08)',
          tint: 'rgba(36, 54, 7, 0.15)',
        },
        secondary: {
          DEFAULT: '#91696E',
          dark: '#765257',
          light: '#ab8288',
          soft: 'rgba(145, 105, 110, 0.12)',
          tint: 'rgba(145, 105, 110, 0.22)',
        },
        dark: {
          DEFAULT: '#30280D',
          surface: '#241e0a',
          deep: '#171305',
          tint: 'rgba(48, 40, 13, 0.08)',
          muted: 'rgba(48, 40, 13, 0.65)',
        },
        neutral: {
          DEFAULT: '#BBBEA7',
          light: '#d0d3c1',
          subtle: '#e4e6db',
          canvas: '#f2f3ec',
          surface: '#f9faf6',
          border: 'rgba(48, 40, 13, 0.12)',
        },
      },
      boxShadow: {
        spatial: '0 8px 24px -4px rgba(48, 40, 13, 0.08), 0 2px 6px -1px rgba(48, 40, 13, 0.04)',
        'spatial-md': '0 12px 32px -6px rgba(48, 40, 13, 0.12), 0 4px 10px -2px rgba(48, 40, 13, 0.06)',
        'spatial-lg': '0 20px 48px -10px rgba(48, 40, 13, 0.18), 0 8px 16px -4px rgba(48, 40, 13, 0.08)',
        'spatial-panel': '0 16px 40px -8px rgba(48, 40, 13, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
        'spatial-inset': 'inset 0 2px 4px rgba(48, 40, 13, 0.06)',
        'spatial-glow': '0 0 24px rgba(36, 54, 7, 0.18)',
      },
    },
  },
}
