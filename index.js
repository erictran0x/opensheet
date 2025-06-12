addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const url = new URL(event.request.url);

  if (url.pathname === "/") {
    return new Response("", {
      status: 302,
      headers: {
        location: "https://github.com/benborgers/opensheet#readme",
      },
    });
  }

  let [id, sheet, ...otherParams] = url.pathname
    .slice(1)
    .split("/")
    .filter((x) => x);

  if (!id || !sheet || otherParams.length > 0) {
    return error("URL format is /spreadsheet_id/sheet_name", 404);
  }

  const cacheKey = `https://opensheet.elk.sh/${id}/${encodeURIComponent(
    sheet
  )}`;
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    console.log(`Serving from cache: ${cacheKey}`);
    return cachedResponse;
  } else {
    console.log(`Cache miss: ${cacheKey}`);
  }

  sheet = decodeURIComponent(sheet.replace(/\+/g, " "));

  const result = await (
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/?key=${GOOGLE_API_KEY}&ranges=${encodeURIComponent(sheet)}&fields=sheets.data.rowData.values(userEnteredValue,hyperlink)`
    )
  ).json();

  if (result.error) {
    return error(result.error.message);
  }

  const rowData = result.sheets?.[0]?.data?.[0]?.rowData || [];
  if (rowData.length === 0) {
    return error("No data found in the specified sheet.");
  }
  const rows = [];
  rowData.forEach((row) => {
    row = row.values;
    row = row.map((cell) => {
      const value = cell.userEnteredValue;
      if (!value) return cell;
      let actualValue = undefined;
      if (value.stringValue !== undefined) {
        actualValue = value.stringValue;
      } else if (value.numberValue !== undefined) {
        actualValue = value.numberValue;
      } else if (value.boolValue !== undefined) {
        actualValue = value.boolValue;
      } else if (value.formulaValue !== undefined) {
        actualValue = value.formulaValue;
      }
      cell.value = actualValue;
      delete cell.userEnteredValue;
      return cell;
    });
    rows.push(row);
  });
  const apiResponse = new Response(JSON.stringify(rows), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `s-maxage=30`,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
    },
  });

  event.waitUntil(cache.put(cacheKey, apiResponse.clone()));

  return apiResponse;
}

const error = (message, status = 400) => {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Origin, X-Requested-With, Content-Type, Accept",
    },
  });
};
