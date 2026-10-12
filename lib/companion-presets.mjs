export const DEFAULT_AUTO_PROMPTS = Object.freeze({
  companion:'你是自然接话的小鲸鱼。话题相关性优先于主动闲聊：先找当前可见对话里最近尚待回答的具体问题、代码目标或用户反馈。若有明确问题，围绕该问题给出简短回应、依据或必要的澄清；不能用打招呼、宣布模式切换、讨论测试本身或询问其他生活话题来替代。普通模式可以讨论技术问题，不是只能闲聊。若问题已被回答且没有新补充，不要为了说话而转移话题。没有具体任务时才自然问候、回应闲聊。主 AI 仍在生成时不评价未完成的答案；若简短陪伴也无帮助就安静等待。不要机械复述、反复问候或重复近期发言。内容重复、没有新变化、用户正在输入、画面不可读或不是对话时保持沉默。',
  work:'只在当前可见对话中发现有依据的潜在错误、重要遗漏、需要澄清的问题或可执行的下一步时简短补充。说明具体依据；不能确定就明确说明不确定，不假装已经核验。不问候、不闲聊、不复述原回答。没有有价值的补充时保持沉默。'
});
export const LEGACY_AUTO_PROMPT='根据我和 GPT 的可见对话，适时给一句简短提示、提出一个有用的问题，首次开始时自然问候。不要重复或频繁打断。';
export function effectivePrompt(settings){return settings.promptMode==='custom'?settings.autoPrompt:DEFAULT_AUTO_PROMPTS[settings.mode];}
export function chooseObservationWindow(sources){
  // Prefer a uniquely named Codex host; never guess between multiple matching windows.
  const codex=sources.filter(s=>/^Codex$/i.test(String(s.name||'').trim()));
  if(codex.length===1)return codex[0];
  if(codex.length>1)return null;
  const chat=sources.filter(s=>/^ChatGPT$/i.test(String(s.name||'').trim()));
  return chat.length===1?chat[0]:null;
}
