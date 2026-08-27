import stylistic from '@stylistic/eslint-plugin';
import pluginVue from 'eslint-plugin-vue';

export default [
    ...pluginVue.configs['flat/strongly-recommended'],
    {
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            'vue/max-attributes-per-line': 'off',
        },
    },
];
