import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [],
    root: './',
    publicDir: 'public',
    assetsInclude: ['**/*.tsurf'], // let Vite treat .tsurf as an asset
    base: '/vtk-tsurf-viewer/', // must match your GitHub repo name
    build: {
        outDir: 'dist'
    }
});

// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'

// export default defineConfig({
//   plugins: [react()],
//   optimizeDeps: {
//     // vtk.js sometimes dislikes prebundling; exclude to be safe
//     exclude: ['@kitware/vtk.js', 'vtk.js'],
//   },
//   assetsInclude: ['**/*.wasm'],
//   server: {
//     // if you work in a VM/WSL or over network file shares, uncomment:
//     // watch: { usePolling: true }
//   },
// })
