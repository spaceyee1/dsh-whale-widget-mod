import fs from 'node:fs'
import {DEFAULT_AUTO_PROMPTS} from './companion-presets.mjs'

// This file belongs to the user's DSH home, outside the replaceable plugin package.
export function readDefaultPrompts(file) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(DEFAULT_AUTO_PROMPTS, null, 2), {encoding:'utf8',flag:'wx'})
    const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))
    if (!value || Array.isArray(value) || ['companion','work'].some(k=>typeof value[k]!=='string'||!value[k].trim()||value[k].length>8000)) throw Error('invalid defaults')
    return {prompts:{companion:value.companion.trim(),work:value.work.trim()},warning:''}
  } catch {
    return {prompts:DEFAULT_AUTO_PROMPTS,warning:'本地默认人设文件无法读取或格式无效，本次使用内置默认；原文件未覆盖。'}
  }
}
