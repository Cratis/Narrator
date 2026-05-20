// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import eslint from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import header from '@tony.ganchev/eslint-plugin-header';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

const getRules = configArray => {
    let rules = {};

    const addRulesFromObject = config => {
        if (config.hasOwnProperty('rules')) {
            rules = {
                ...rules,
                ...config.rules,
            };
        }
    };

    if (Array.isArray(configArray)) {
        for (const config of configArray) {
            addRulesFromObject(config);
        }
    } else {
        addRulesFromObject(configArray);
    }

    return rules;
};

const rules = {
    ...getRules(eslint.configs.recommended),
    ...getRules(tseslint.configs.recommended),
    ...{
        'no-irregular-whitespace': 0,
        semi: [2, 'always'],

        '@typescript-eslint/no-unused-vars': [
            'error',
            {
                ignoreRestSiblings: true,
            },
        ],

        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/explicit-module-boundary-types': 0,
        '@typescript-eslint/no-non-null-assertion': 0,
        '@typescript-eslint/no-empty-function': 'error',
        '@typescript-eslint/no-var-requires': 'error',
        '@typescript-eslint/ban-ts-comment': 0,
        '@typescript-eslint/no-empty-interface': 0,

        '@tony.ganchev/header': [
            2,
            'line',
            [
                ' Copyright (c) Cratis. All rights reserved.',
                ' Licensed under the MIT license. See LICENSE file in the project root for full license information.'
            ],
            1
        ],
    },
};

const defaultConfig = [
    {
        ignores: [
            '**/*.d.ts',
            '**/tsconfig.*',
            '**/*.js',
            '**/out/**',
            '**/node_modules/**',
        ],
    },
    {
        files: ['**/*.ts'],

        plugins: {
            '@typescript-eslint': typescriptEslint,
            '@tony.ganchev': header,
        },

        rules: rules,

        languageOptions: {
            globals: {
                ...globals.node,
            },
            parser: tsParser,
            sourceType: 'module',
        },
    },
    {
        files: ['**/for_*/**/*.ts'],
        rules: {
            '@typescript-eslint/naming-convention': 0,
            '@typescript-eslint/no-unused-expressions': 0,
            '@typescript-eslint/no-empty-function': 'off',
            'no-restricted-globals': 0,
        },
    },
];

const config = tseslint.config(...defaultConfig);
export default config;
