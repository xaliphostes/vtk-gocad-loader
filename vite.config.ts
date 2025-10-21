import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [],
    root: './',
    publicDir: 'public',
    assetsInclude: ['**/*.tsurf'], // let Vite treat .tsurf as an asset
    base: '/vtk-gocad-loader/', // must match your GitHub repo name
    build: {
        outDir: 'dist'
    }
});

