import { body, validationResult } from "express-validator";
import { runAgentWorkflow } from "../services/agentWorkflowService.js";

export const agentCommandValidators = [
  body("text").optional().isString(),
  body("voiceFileId").optional().isString()
];

export const runAgentCommand = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const result = await runAgentWorkflow({
      channel: "ui",
      userId: req.userId,
      channelUserId: `ui:${req.userId}`,
      text: req.body.text,
      voiceFileId: req.body.voiceFileId
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Agent workflow failed", error: error.message });
  }
};
