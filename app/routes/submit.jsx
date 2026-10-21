import { authenticate } from "../shopify.server";

function formatPhone(phone) {
  const clean = (phone || "").replace(/\s|-/g, "");
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('00')) return '+' + clean.slice(2);
  if (clean.startsWith('0') && clean.length === 10) return '+212' + clean.slice(1);
  return '+212' + clean;
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { session, admin } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response(JSON.stringify({ error: "Invalid proxy signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { fullName, phone, address, city, variantId, quantity } = body || {};

  // --- Validation ---
  const errors = [];
  if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
    errors.push("fullName");
  }
  const phoneClean = (phone || "").replace(/\s|-/g, "");
  if (!/^(0[5-7]\d{8}|\+212[5-7]\d{8})$/.test(phoneClean)) {
    errors.push("phone");
  }
  if (!address || typeof address !== "string" || address.trim().length < 3) {
    errors.push("address");
  }
  if (!city || typeof city !== "string" || city.trim().length < 2) {
    errors.push("city");
  }
  const variantGid =
    typeof variantId === "number" || /^\d+$/.test(String(variantId))
      ? `gid://shopify/ProductVariant/${variantId}`
      : null;
  if (!variantGid) {
    errors.push("variantId");
  }
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", fields: errors }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- تحويل الهاتف للفورمات الدولي ---
  const phoneE164 = formatPhone(phoneClean);

  // --- Mutation ---
  const mutation = `#graphql
    mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    order: {
      lineItems: [
        {
          variantId: variantGid,
          quantity: qty,
        },
      ],
      shippingAddress: {
        firstName: fullName.trim().split(" ")[0] || fullName.trim(),
        lastName: fullName.trim().split(" ").slice(1).join(" ") || "-",
        address1: address.trim(),
        city: city.trim(),
        phone: phoneE164,
        countryCode: "MA",
      },
      phone: phoneE164,
      tags: ["COD"],
      note: `Commande COD via popup. Offre spéciale: ${
        body.upsell ? "oui" : "non"
      }`,
      financialStatus: "PENDING",
    },
    options: {
      sendReceipt: false,
      sendFulfillmentReceipt: false,
    },
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const data = await response.json();

    const result = data?.data?.orderCreate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Shopify rejected the order", details: userErrors }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId: result.order.id,
        orderName: result.order.name,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Order creation failed:", err);
    return new Response(
      JSON.stringify({ error: "Internal error while creating order" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};