async function metaPost(payload: object) {
  const phoneId = process.env.META_WHATSAPP_PHONE_ID;
  const token   = process.env.META_WHATSAPP_TOKEN;
  if (!phoneId || !token) throw new Error("META_WHATSAPP_PHONE_ID and META_WHATSAPP_TOKEN must be set");

  const res = await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  console.log("[whatsapp] Meta response:", JSON.stringify(data));
  if (!res.ok) throw new Error(data?.error?.message ?? `Meta API error ${res.status}`);
}

export async function sendWhatsApp(to: string, body: string) {
  const num = to.replace(/^\+/, "");
  await metaPost({
    messaging_product: "whatsapp",
    to: num,
    type: "text",
    text: { body },
  });
}

export async function sendWhatsAppTemplate(to: string, templateName: string, variables: string[] = [], languageCode = "en") {
  const num = to.replace(/^\+/, "");
  await metaPost({
    messaging_product: "whatsapp",
    to: num,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(variables.length > 0 && {
        components: [{
          type: "body",
          parameters: variables.map(v => ({ type: "text", text: v })),
        }],
      }),
    },
  });
}
