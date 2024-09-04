require("dotenv").config(); // Load environment variables from .env file
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const OpenAI = require("openai");

const app = express();

const SHOP_URL = process.env.SHOP_URL;
const BLOG_ID = process.env.BLOG_ID; 
const ACCESS_TOKEN = process.env.ACCESS_TOKEN; 

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(bodyParser.json());

const threadTimeouts = {};

app.get("/", async (req, res) => {
    res.send('working...');
});

app.get("/start", async (req, res) => {
    try {
        const thread = await openai.beta.threads.create();
        res.json({ thread_id: thread.id });
    } catch (error) {
        console.error("Error creating thread:", error);
        res.status(500).json({ error: "Failed to create thread" });
    }
});

const tools = [
    {
        "type": "function",
        "function": {
            "name": "isValidQuestion",
            "description": "Use this function to determine if the user's message is a question. If the message is a question, return 'true'; if it is a statement, greeting, or irrelevant message, return 'false'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "isValid": {
                        "type": "string",
                        "enum": ["true", "false"],
                        "description": "'true' if the message is a valid question; otherwise 'false' (all lowercase)."
                    }
                },
                "required": [
                    "isValid"
                ]
            }
        }
    }
];

function convertNewLinesAndBold(text) {
    // Replace new lines with <br>
    let formattedText = text.replace(/\n/g, '<br>');

    // Replace **text** with <strong>text</strong> for bold
    formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    return formattedText;
}

// Function to create the article on Shopify
async function createArticleOnShopify(title, content) {
    const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: `Improve and optimize the user's question to create a concise and SEO-friendly blog post title. If the question is too long for the meta title, shorten it while retaining key information. Return only the adjusted title without quotes, as your response will be used directly as the blog post title. Here is the user question: ${title}` }],
        model: "gpt-4o",
      });
    
      console.log(completion.choices[0]);
  // Convert new lines in content to <br> for HTML
  const htmlContent = convertNewLinesAndBold(content);
    // Article data
    const articleData = {
      article: {
        blog_id: BLOG_ID,
        title: title,
        author: 'Mitchel Blok',
        body_html: htmlContent,
        summary_html: htmlContent,
        published_at: new Date().toISOString()
      },
    };

    // API endpoint for creating an article
    const apiVersion = '2023-10';
    const createArticleUrl = `${SHOP_URL}/admin/api/${apiVersion}/blogs/${BLOG_ID}/articles.json`;

    // Headers for the request
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ACCESS_TOKEN,
    };

    try {
      const response = await fetch(createArticleUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(articleData),
      });

      const responseData = await response.json();
      if (response.status === 201) {
        console.log('Article created successfully on Shopify.');
      } else {
        console.log('Failed to create article on Shopify.');
        console.log('Error:', responseData);
      }
    } catch (error) {
      console.error('Error creating article on Shopify:', error.message);
    }
  }

async function isValidQuestion(isValid, userMessage, AIResponse) {
    console.log('isValid ', isValid);
    if (isValid == 'true') {
        createArticleOnShopify(userMessage, AIResponse);
    }
}

app.post("/chat", async (req, res) => {
    const assistantId = process.env.ASSISTANT_ID;
    console.log('threadTimeouts: ', threadTimeouts);
    const { message } = req.body;

  const thread = await openai.beta.threads.create();
  const threadId = thread.id;


    try {
        console.log(`Received message: ${message} for thread ID: ${threadId}`);
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: message,
        });

        const run = await openai.beta.threads.runs.createAndPoll(threadId, {
            assistant_id: assistantId,
        });

        const messages = await openai.beta.threads.messages.list(run.thread_id);
        const response = messages.data[0].content[0].text.value;

        console.log('Assistant response: ', response);

        let messages2 = [
            {
                "role": "user",
                "content": `is this user message a question ${message} - use (isValidQuestion) function to state if its a question or not`
            }
        ];

        const checkValidity = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages2,
            tools: tools,
            tool_choice: { "type": "function", "function": { "name": "isValidQuestion" } },
        });

        const responseMessage = checkValidity.choices[0].message;

        const toolCalls = responseMessage.tool_calls;
        if (responseMessage.tool_calls) {
            const availableFunctions = {
                isValidQuestion: (args) => isValidQuestion(args, message, response),
            };
            for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;
                const functionToCall = availableFunctions[functionName];
                const functionArgs = JSON.parse(toolCall.function.arguments);
                console.log('functionArgs ', functionArgs)
                await functionToCall(functionArgs.isValid);
            }
        }

        res.json({ response });
    } catch (error) {
        console.error("Error handling chat:", error);
        res.status(500).json({ error: "Failed to process chat" });
    }
});

port = 8080;

app.listen(port, () => {
    console.log("Server running on port 8080");
});
