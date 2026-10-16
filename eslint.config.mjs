// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/api/defaults'
import { MatcherType, SelectorKind } from 'eslint-plugin-better-tailwindcss/api/types'

export default withNuxt(
  {
    // DDEV config and the container home (incl. Composer vendor files)
    ignores: ['.ddev/**']
  },
  {
    rules: {
      'vue/no-multiple-template-root': 'off',
      'vue/max-attributes-per-line': ['error', { singleline: 3 }]
    }
  },
  betterTailwindcss.configs['correctness-error'],
  {
    settings: {
      'better-tailwindcss': {
        entryPoint: 'layers/core/app/assets/css/main.css',
        selectors: [
          ...getDefaultSelectors(),
          { kind: SelectorKind.Attribute, name: '^v-bind:ui$', match: [{ type: MatcherType.ObjectValue }] }
        ]
      }
    }
  }
)
