import type { Config } from 'tailwindcss';

export default {
    darkMode: ['class'],
    content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
  	extend: {
  		colors: {
  			ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
  			paper: 'rgb(var(--paper-rgb) / <alpha-value>)',
  			pine: 'rgb(var(--pine-rgb) / <alpha-value>)',
  			ember: 'rgb(var(--ember-rgb) / <alpha-value>)',
  			slate: 'rgb(var(--slate-rgb) / <alpha-value>)',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		fontFamily: {
  			display: [
  				'SF Pro Display"',
  				'SF Pro Text"',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Helvetica Neue"',
  				'Noto Sans SC"',
  				'sans-serif'
  			],
  			body: [
  				'SF Pro Text"',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Helvetica Neue"',
  				'Noto Sans SC"',
  				'sans-serif'
  			],
  			mono: [
  				'SFMono-Regular"',
  				'Menlo',
  				'Monaco',
  				'IBM Plex Mono"',
  				'monospace'
  			]
  		},
  		boxShadow: {
  			card: '0 14px 28px rgb(var(--shadow-rgb) / 0.16)'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")]
} satisfies Config;
