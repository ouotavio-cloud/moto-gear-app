/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./www/index.html', './www/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        gear: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          orange: '#f97316',
          orangedark: '#ea580c'
        }
      }
    }
  },
  plugins: []
};
