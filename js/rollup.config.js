import resolve from 'rollup-plugin-node-resolve';
import commonJS from 'rollup-plugin-commonjs';

export default {
    input: 'a.js',
    output: {
        file: 'bundle.js',
        name: 'bundle',
        format: 'iife'
    },
    plugins: [
        resolve(),
        commonJS({
            include: 'node_modules/**'
        })
    ]
};