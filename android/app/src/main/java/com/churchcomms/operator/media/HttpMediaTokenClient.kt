package com.churchcomms.operator.media

import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

private val JSON = "application/json; charset=utf-8".toMediaType()

/** Fetches a LiveKit join token from the control server over plain LAN HTTP. */
class HttpMediaTokenClient(
    private val client: OkHttpClient = OkHttpClient(),
) : MediaTokenClient {
    override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
        withContext(Dispatchers.IO) {
            val body = buildJsonObject {
                put("identity", "operator-${UUID.randomUUID()}")
                put("name", name)
                put("role", "operator")
            }.toString()

            val request = Request.Builder()
                .url(tokenUrl)
                .post(body.toRequestBody(JSON))
                .build()

            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = runCatching {
                        Json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content
                    }.getOrNull()
                    throw IOException(
                        message ?: "Token endpoint answered HTTP ${response.code}.",
                    )
                }

                val json = Json.parseToJsonElement(text).jsonObject
                MediaToken(
                    url = json["url"]?.jsonPrimitive?.content
                        ?: throw IOException("Token response has no LiveKit URL."),
                    token = json["token"]?.jsonPrimitive?.content
                        ?: throw IOException("Token response has no token."),
                )
            }
        }
}
