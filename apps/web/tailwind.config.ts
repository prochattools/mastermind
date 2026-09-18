import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)']
      },
      colors: {
        mm: {
          canvas: 'rgb(var(--canvas) / <alpha-value>)',
          surface: 'rgb(var(--surface) / <alpha-value>)',
          subtle: 'rgb(var(--surface-subtle) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          border: 'rgb(var(--border) / <alpha-value>)',
          'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
          text: 'rgb(var(--text) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          'subtle-text': 'rgb(var(--text-subtle) / <alpha-value>)',
          accent: 'rgb(var(--accent) / <alpha-value>)',
          focus: 'rgb(var(--focus-ring) / <alpha-value>)',
          success: 'rgb(var(--success) / <alpha-value>)',
          warning: 'rgb(var(--warning) / <alpha-value>)',
          danger: 'rgb(var(--danger) / <alpha-value>)'
        },
        bf: {
          bg: 'rgb(var(--bf-bg) / <alpha-value>)',
          surface: 'rgb(var(--bf-surface) / <alpha-value>)',
          subtle: 'rgb(var(--bf-surface-subtle) / <alpha-value>)',
          border: 'rgb(var(--bf-border) / <alpha-value>)',
          text: 'rgb(var(--bf-text) / <alpha-value>)',
          muted: 'rgb(var(--bf-muted) / <alpha-value>)',
          accent: 'rgb(var(--bf-accent) / <alpha-value>)',
          success: 'rgb(var(--bf-success) / <alpha-value>)',
          warning: 'rgb(var(--bf-warning) / <alpha-value>)',
          danger: 'rgb(var(--bf-danger) / <alpha-value>)'
        }
      }
    }
  },
  plugins: []
}
export default config
