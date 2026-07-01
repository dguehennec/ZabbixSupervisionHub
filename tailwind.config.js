/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{vue,html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        zabbix: {
          disaster: '#e45959',
          high: '#e97659',
          average: '#ffa059',
          warning: '#ffc859',
          info: '#7499ff',
          ok: '#59db8f',
        },
      },
    },
  },
  plugins: [],
};
