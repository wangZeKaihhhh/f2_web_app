import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        paper: 'rgb(var(--paper-rgb) / <alpha-value>)',
        pine: 'rgb(var(--pine-rgb) / <alpha-value>)',
        ember: 'rgb(var(--ember-rgb) / <alpha-value>)',
        slate: 'rgb(var(--slate-rgb) / <alpha-value>)'
      },
      fontFamily: {
        display: [
          '"SF Pro Display"',
          '"SF Pro Text"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Helvetica Neue"',
          '"Noto Sans SC"',
          'sans-serif'
        ],
        body: [
          '"SF Pro Text"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Helvetica Neue"',
          '"Noto Sans SC"',
          'sans-serif'
        ],
        mono: ['"SFMono-Regular"', 'Menlo', 'Monaco', '"IBM Plex Mono"', 'monospace']
      },
      boxShadow: {
        card: '0 14px 28px rgb(var(--shadow-rgb) / 0.16)'
      }
    }
  },
  plugins: []
} satisfies Config;
