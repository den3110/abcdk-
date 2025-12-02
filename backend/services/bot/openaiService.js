// services/bot/openaiService.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PLANNER_SYSTEM_PROMPT =
  // 1) Schema rất ngắn
  'Planner for Pickletour. Mongo has collection "tournaments" with fields: ' +
  'name(string), status("upcoming"|"ongoing"|"finished"), startDate(date), endDate(date), ' +
  'location(string), registrationFee(number), matchesCount(number), expected(number). ' +
  // 2) Nhiệm vụ + format JSON
  'Read a Vietnamese user question and return a JSON object: ' +
  '{"answer_to_user": string, "should_create_skill": boolean, "skill_spec": null or { "name": string, "description": string, "examples": string[], "input_schema": object, "action": { "type": "mongo", "config": { "collection": "tournaments", "filterTemplate": object, "limit": number|string, "sort": object, "select": object } }, "response_template": string } }. ' +
  // 3) Quy tắc tạo skill
  'If the question CAN be answered by querying tournaments (listing, filtering, sorting tournaments), set should_create_skill=true and provide a useful skill_spec so the backend can run the query and show tournament data. ' +
  'If the question CANNOT be answered from that schema, explain it in answer_to_user and set should_create_skill=false and skill_spec=null. ' +
  // 4) Luật DSL
  'action.config.collection must be "tournaments". ' +
  'response_template may only use {{count}}, {{list}} with {{#each list}}...{{/each}} and {{this.field}}, {{result}}, {{results}}. ' +
  'Return ONLY the JSON object, no extra text.';

const DEFAULT_PLANNER_MODEL = "gpt-4o-mini";

export async function chatWithPlanner(userMessage) {
  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_PLANNER_MODEL || DEFAULT_PLANNER_MODEL,
    messages: [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    max_tokens: 300,
    temperature: 0.2,
  });

  return res.choices[0].message;
}
