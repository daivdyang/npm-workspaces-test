# WebSocket基礎知識整理

## websocket與sse主要的差異與優劣

WebSocket 與 SSE（Server-Sent Events）的主要差異與優劣比較
兩者都是讓伺服器主動推送資料給瀏覽器的技術，但設計目標與能力差異很大。

1. 核心差異總覽

    | 項目 | WebSocket | SSE (Server-Sent Events) |
    | --- | --- | --- |
    | 通訊方向 | 雙向（Full-duplex） | 單向（只能 Server → Client） |
    | 協議基礎 | 獨立協議（ws:// / wss://），握手後升級為 WebSocket | 基於標準 HTTP（通常是 HTTP/1.1 長連線） |
    | 連線方式 | 一次握手後保持持久連線 | 透過 HTTP 長連線（keep-alive），瀏覽器自動重連 |
    | 資料格式 | 二進位或文字皆可，非常彈性 | 主要是文字（UTF-8），有固定事件格式 |
    | 瀏覽器支援 | 幾乎全面支援（包括舊版 IE 需 polyfill） | 現代瀏覽器原生支援（IE/Edge 舊版不支援） |
    | 自動重連 | 需自己實作 | 瀏覽器原生自動重連 + 內建 `Last-Event-ID` 機制 |
    | 典型用途 | 聊天、即時遊戲、協作編輯、即時交易 | 即時通知、股價更新、進度條、日誌串流、新聞推送 |
    | HTTP/1.1 連線數限制 | 不受同網域 6 條限制 | 受限（同網域最多約 6 條） |
    | Proxy / CDN / 防火牆相容性 | 需要中介層支援 Upgrade | 幾乎都能通過 |
    | 每則訊息額外開銷 | frame header 2–14 bytes，非常小 | 有 data: 等文字前綴，略大 |

    重點差異說明:

    1. 重連與訊息補發

        這是 SSE 最被低估的優點。`EventSource` 斷線後會依 `retry` 指定的毫秒數自動重連。重連時，瀏覽器會在請求標頭帶上最後收到的 `Last-Event-ID`，伺服器可據此補發中間漏掉的訊息。

        WebSocket 斷線只會觸發 `onclose`。重連、指數退避、補發漏掉的訊息、重新訂閱頻道，全部要自己寫，或改用 Socket.IO 這類函式庫。

    2. 連線數限制

        在 HTTP/1.1 下，瀏覽器對同一網域最多約 6 條並行連線。SSE 會長期佔住其中一條，使用者開多個分頁時很容易用完，導致其他 API 請求卡住。

        使用 HTTP/2 或 HTTP/3 就沒有這個問題，因為多條串流共用同一條連線（預設通常可以有約 100 條串流）。所以部署 SSE 時，HTTP/2 幾乎是必要條件。

    3. 驗證（Auth）

        兩者在瀏覽器端都無法自訂 request header，所以都不能直接帶 `Authorization: Bearer ...`。常見做法有幾種：

        - 使用 cookie（同網域時最簡單）
        - 把短效 token 放在 query string（注意會留在 log 裡）
        - WebSocket 可以連上後在第一則訊息送 token，或塞在 `Sec-WebSocket-Protocol` 子協定欄位
        - SSE 可以改用 `fetch` 搭配 `ReadableStream` 自己解析事件流（例如 `@microsoft/fetch-event-source`）。這樣就能帶 header 和 POST body，但需要自己處理重連

    4. 基礎設施相容性

        SSE 就是 HTTP，所以既有的負載平衡器、CDN、API Gateway、HTTP 監控工具都能直接使用。要注意的主要是緩衝問題：Nginx 預設會 buffer 回應，導致訊息卡住不送出。解法是：

        - 設定 `proxy_buffering off;`，或在回應加上 `X-Accel-Buffering: no`
        - 確認 gzip 壓縮中介層不會累積資料才送出

        WebSocket 則需要每一層 proxy 都正確轉發 `Upgrade` 與 `Connection` 標頭。部分企業防火牆或舊型 proxy 會擋掉或中斷 WebSocket 連線。

    5. 水平擴展

        兩者都是長連線，伺服器都要維持大量 open connection。多台機器時，通常都需要 Redis Pub/Sub、NATS 之類的訊息中介來廣播事件。

        WebSocket 常帶有連線狀態（例如訂閱了哪些頻道），因此較常需要 sticky session。SSE 的狀態可以透過 URL 參數與 `Last-Event-ID` 重建，比較接近無狀態，擴展上相對單純。

    6. 效能

        在高頻、小封包、雙向的場景，WebSocket 的開銷明顯較低，也支援二進位格式（例如 protobuf、MessagePack）與 `permessage-deflate` 壓縮。

        SSE 只能傳文字，二進位資料要 base64 編碼，體積會增加約 33%。不過對一般 JSON 推播來說，兩者的差距通常不是瓶頸。

2. 技術細節比較

    WebSocket

    - 握手階段用 HTTP，成功後協議升級，之後就是真正的雙向通訊。
    - 連線建立後，雙方都可以隨時主動發送訊息，延遲極低。
    - 支援二進位資料（適合傳圖片、音訊、自訂協議等）。
    - 需要處理心跳（ping/pong）、重連、斷線偵測、負載平衡等問題。

    SSE

    - 本質上就是一個永不結束的 HTTP 回應（`Content-Type: text/event-stream`）。
    - 伺服器可以持續寫入資料，格式大致如下：
        ```text
        event: message
        id: 123
        data: {"price": 100.5}

        data: 另一行資料
        ```
    - 瀏覽器的 EventSource API 會自動解析，並在連線斷開時自動重連（預設 3 秒），還會帶上 Last-Event-ID。
    - 只能從伺服器推送到客戶端，客戶端若要回傳資料，必須另外發普通 HTTP 請求。

3. 優缺點比較

    WebSocket 優點

    - 真正的雙向即時通訊，延遲最低。
    - 傳輸效率高（沒有 HTTP header 開銷）。
    - 可傳二進位資料，適用場景最廣。
    - 適合高頻互動（聊天室、多人遊戲、協同編輯）。

    WebSocket 缺點

    - 實作與維護成本較高（重連、心跳、狀態同步都要自己處理）。
    - 負載平衡與防火牆相對麻煩（有些代理不支援 WebSocket 或需要特別設定）。
    - 若只需要單向推送，會顯得過度設計。
    - 瀏覽器連線數有限制（通常同一域名約 6 條），大量分頁時要注意。

    SSE 優點

    - 極為簡單，幾乎零學習成本（前端只需 new EventSource(url)）。
    - 原生自動重連與 Last-Event-ID，可靠性高。
    - 走標準 HTTP，防火牆與代理相容性極佳。
    - 可利用現有 HTTP 基礎設施（CDN、負載平衡、認證機制）。
    - 適合「伺服器主動推送、客戶端被動接收」的場景。

    SSE 缺點

    - 只能單向，客戶端無法透過同一連線回傳資料。
    - 只能傳文字（雖然可以自己編碼 JSON 或 base64）。
    - HTTP/1.1 下同一域名連線數有限（通常 6 條），大量分頁可能會卡住。
    - 舊版瀏覽器（特別是 IE）支援不佳。
    - 高頻小訊息時，HTTP header 與連線開銷相對較大（雖然實際影響通常不大）。

4. 選擇建議

    | 情境 | 建議使用 |
    | --- | --- |
    | 聊天室、即時遊戲、協作白板、即時語音/視訊信令 | WebSocket |
    | 股價/加密貨幣即時報價、通知中心、進度更新、日誌串流、新聞推送 | SSE 通常就夠用，且更簡單 |
    | 需要雙向但互動不頻繁 | 可以「SSE + 普通 HTTP POST」組合使用 |
    | 對相容性與維護成本要求高 | 優先考慮 SSE |
    | 需要傳二進位或極高即時性 | 優先考慮 WebSocket |

Websocket各瀏覽器的上限

以下是常被引用的數字。這些屬於瀏覽器內部實作，官方文件很少明確記載，版本更新也可能改變，請當成量級參考，需要精確數字時建議自己寫測試頁驗證。

| 瀏覽器 | 上限（常見說法）| 說明 |
| -- | -- | -- |
| Chrome / Edge（Chromium）| 整個瀏覽器約 255 條 | 所有分頁共用 |
| Firefox | 預設 200 條 | 可在 about:config 的 `network.websocket.max-connections` 查看與調整 |
| Safari | 沒有公開文件 | 實測行為依版本而異，行動版 iOS 另受背景凍結影響 |

## WebSocket Frame Structure (RFC 6455)

1. Frame 整體結構圖（RFC 6455 §5.2）
    ```text
    0                   1                   2                   3
    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
    +-+-+-+-+-------+-+-------------+-------------------------------+
    |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
    |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
    |N|V|V|V|       |S|             |   (if payload len==126/127)   |
    | |1|2|3|       |K|             |                               |
    +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
    |     Extended payload length continued, if payload len == 127  |
    + - - - - - - - - - - - - - - - +-------------------------------+
    |                               |Masking-key, if MASK set to 1  |
    +-------------------------------+-------------------------------+
    | Masking-key (continued)       |          Payload Data         |
    +---------------------------------------------------------------+
    ```

2. 各欄位詳細說明

    | 欄位 | 大小 | 說明 |
    | --- | --- | --- |
    | FIN | 1 bit | 1 = 這是訊息的最後一個 fragment 0 = 還有後續 fragment （第一個 frame 也可以同時是最後一個） |
    | RSV1, RSV2, RSV3 | 各 1 bit | 保留位元。必須為 0，除非協商了使用這些位元的 extension（例如 permessage-deflate 使用 RSV1）。收到非 0 且未協商對應 extension 時必須關閉連線。 |
    | Opcode | 4 bits | 定義 payload 的解讀方式（見下方表格） |
    | MASK | 1 bit | 1 = payload 有被 masking Client → Server 必須為 1 Server → Client 必須為 0 |
    | Payload length | 7 bits | 三種情況： • 0–125 → 直接就是 payload 長度 • 126 → 後面跟著 2 bytes（16-bit 無符號整數）表示真實長度 • 127 → 後面跟著 8 bytes（64-bit 無符號整數，最高位必須為 0）表示真實長度 |
    | Extended payload length | 0 / 16 / 64 bits | 當 payload length 為 126 或 127 時出現（big-endian） |
    | Masking-key | 0 或 4 bytes | 當 MASK = 1 時出現。32-bit 隨機值，用來 XOR 遮罩 payload。 |
    | Payload Data | 變長 | 實際資料（可能包含 extension data + application data） |

3. Opcode 定義

    | Opcode | 類型 | 說明 |
    | --- | --- | --- |
    | 0x0 | Continuation | 延續前一個 frame 的資料（用於 fragmentation） |
    | 0x1 | Text | UTF-8 文字資料 |
    | 0x2 | Binary | 二進位資料 |
    | 0x3–0x7 | Reserved | 保留給未來的非控制 frame |
    | 0x8 | Close | 關閉連線（控制 frame） |
    | 0x9 | Ping | 心跳 / 存活檢查（控制 frame） |
    | 0xA | Pong | 回應 Ping（控制 frame） |
    | 0xB–0xF | Reserved | 保留給未來的控制 frame |

    控制 frame 規則：

    - 長度不能超過 125 bytes
    - 不能被 fragmentation（FIN 必須為 1）
    - 可以插入在被分割的 data message 中間

4. Masking（遮罩）機制

    - 目的：防止某些中間設備（proxy）把 WebSocket 流量誤判為 HTTP 並進行錯誤快取或攻擊（cache poisoning）。
    - 規則：
        * Client 送出的所有 frame 都必須 mask。
        * Server 送出的 frame 禁止 mask。

    - 演算法：
        ```text
        for i = 0 to payload_length - 1:
            transformed[i] = original[i] XOR masking_key[i % 4]
        ```
    - Masking key 必須是每次隨機產生的 32-bit 值。

5. Fragmentation（訊息分割）

    一個完整的 message 可以由多個 frame 組成：

    1. 第一個 frame：Opcode = `0x1`（Text）或 `0x2`（Binary），FIN = 0
    2. 中間 frame：Opcode = `0x0`（Continuation），FIN = 0
    3. 最後一個 frame：Opcode = `0x0`，FIN = 1

    控制 frame 可以穿插在 fragmented message 中間，但本身不能被分割。

6. 實際例子

    Server → Client（未 mask）傳送 "Hello"：

    ```text
    81 05 48 65 6c 6c 6f
    ```

    - `81` = FIN=1 + Opcode=0x1 (Text)
    - `05` = MASK=0 + length=5
    - `48 65 6c 6c 6f` = "Hello"

    Client → Server（有 mask）傳送 "Hello"（masking key = `37 fa 21 3d`）：

    ```text
    81 85 37 fa 21 3d 7f 9f 4d 51 58
    ```

    - `81` = FIN=1 + Opcode=0x1
    - `85` = MASK=1 + length=5
    - `37 fa 21 3d` = masking key
    - 後面是被 XOR 後的資料

    Fragmented 例子（"Hel" + "lo"）：

    ```text
    01 03 48 65 6c   ← FIN=0, Opcode=0x1, "Hel"
    80 02 6c 6f      ← FIN=1, Opcode=0x0, "lo"
    ```

7. 關鍵重點整理

    | 項目 | 說明 |
    | --- | --- |
    | Header 最小大小 | 2 bytes |
    | Header 最大大小 | 14 bytes（FIN+Opcode+MASK+127 + 8-byte length + 4-byte mask） |
    | Client → Server | 必須 mask |
    | Server → Client | 禁止 mask |
    | 控制 frame | ≤ 125 bytes，不可 fragmentation |
    | 長度編碼 | 必須使用最短編碼（minimal encoding） |
    | RSV 位元 | 預設必須為 0，除非有 extension 協商 |

    這個設計讓 WebSocket 在保持低延遲與低開銷的同時，仍能透過 masking 與 fragmentation 機制兼顧安全性與彈性。

## WebSocket Extension Negotiation

WebSocket 擴展（Extensions）允許在不破壞向後相容的情況下，為協議增加新功能（例如壓縮、加密、自訂 framing 等）。協商完全在 opening handshake 階段完成，使用 `Sec-WebSocket-Extensions` HTTP header。

1. 協商流程總覽

    | 角色 | 行為 |
    | --- | --- |
    | Client | 在握手請求中列出自己支援的 extension（可含參數），按偏好順序排列 |
    | Server | 從 client 提供的清單中選擇自己支援的 extension，並在回應中回傳接受的結果 |
    | 結果 | 只有雙方都同意的 extension 才會啟用；未協商成功的 extension 不會生效 |

2. Header 格式（RFC 6455 §9.1 & §11.3.2）

    語法（ABNF 簡化）：
    
    ```http
    Sec-WebSocket-Extensions = 1#extension
    extension                 = extension-token *( ";" extension-param )
    extension-token           = token
    extension-param           = token [ "=" (token | quoted-string) ]
    ```

    - 多個 extension 用逗號 `,` 分隔
    - 每個 extension 的參數用分號 `;` 分隔
    - Client 可以在一個請求中發送多個 `Sec-WebSocket-Extensions` header（等效於合併）
    - Server 的回應中此 header 最多只能出現一次

3. 實際握手範例

    Client 請求（提供兩個 extension）：

    ```http
    GET /chat HTTP/1.1
    Host: example.com
    Upgrade: websocket
    Connection: Upgrade
    Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
    Sec-WebSocket-Version: 13
    Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits, bbf-usp-protocol
    ```

    Server 成功接受（只接受壓縮）：

    ```http
    HTTP/1.1 101 Switching Protocols
    Upgrade: websocket
    Connection: Upgrade
    Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
    Sec-WebSocket-Extensions: permessage-deflate
    ```

    Server 接受並帶參數：

    ```http
    Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover
    ```

4. 最常見的 Extension：permessage-deflate（RFC 7692）

    這是目前唯一被廣泛實作的標準 extension，用來對 每個 message 的 payload 進行 DEFLATE 壓縮。

    主要參數

    | 參數 | 說明 |
    | --- | --- |
    | server_no_context_takeover | Server 不重用壓縮上下文（每則 message 獨立壓縮） |
    | client_no_context_takeover | Client 不重用壓縮上下文 |
    | server_max_window_bits | Server 端 LZ77 sliding window 大小（8–15） |
    | client_max_window_bits | Client 端 LZ77 sliding window 大小（8–15） |

    Client 常見 offer：

    ```http
    Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits
    ```

5. Extension 如何影響 Frame

    成功協商後，extension 可以使用以下機制：

    - RSV1 / RSV2 / RSV3 位元（frame header 的保留位）
        * `permessage-deflate` 使用 RSV1 來標記「此 message 有被壓縮」
    - Extension Data 欄位（位於 Payload Data 之前）
    - 新的 Opcode（0x3–0x7、0xB–0xF 保留給 extension）

    若收到非 0 的 RSV 位元，但沒有對應已協商的 extension，接收端必須`關閉連線`。

6. IANA 註冊

    Extension 名稱應註冊到 IANA WebSocket Extension Name Registry（First Come First Served）。

    目前已註冊的主要項目：

    - `permessage-deflate`（RFC 7692）
    - `bbf-usp-protocol`（Broadband Forum USP Protocol）

    自訂 extension 也可以使用，但建議先註冊以避免衝突。

7. 實作注意事項

    | 項目 | 說明 |
    | --- | --- |
    | 瀏覽器行為 | 大多數現代瀏覽器會自動協商 permessage-deflate（Safari 過去支援較弱） |
    | 順序 | Client 提供的清單有優先順序；Server 應選擇第一個自己支援的 |
    | 參數驗證 | Server 只能回傳 Client 有提出的參數；回傳未知參數會導致協商失敗 |
    | 多個相同 extension | Client 可以針對同一個 extension 提出多組不同參數，Server 選擇其中一組 |
    | 不相容檢測 | 某些 extension 彼此不相容，實作時需檢查 IANA 的 "Known Incompatible Extensions" |
    | 失敗處理 | 若 Server 回傳了 Client 沒有 offer 的 extension，Client 必須關閉連線（code 1010） |

8. 與 Subprotocol 的差異

    | 比較項目 | Extension | Subprotocol (Sec-WebSocket-Protocol) |
    | --- | --- | --- |
    | 層級 | 協議層（framing、壓縮等） | 應用層（業務協議） |
    | 可同時使用 | 多個 | 通常只選一個 |
    | 影響 | Frame 結構、RSV 位元、壓縮 | 應用資料的解讀方式 |
    | 範例 | permessage-deflate | chat, superchat, graphql-ws |


總結

WebSocket Extension 協商是一個輕量且彈性的機制：

1. Client 在握手時用 Sec-WebSocket-Extensions 提出支援的功能與參數
2. Server 選擇並回傳接受的結果
3. 雙方在後續的 frame 傳輸中依協商結果使用 RSV 位元與 Extension Data

目前最實用且普及的 extension 是 `permessage-deflate`，能有效降低文字或 JSON 類訊息的頻寬消耗。

## permessage-deflate Compression Details

`permessage-deflate` 是目前最廣泛使用的 WebSocket 擴展，屬於 Per-Message Compression Extension (PMCE)。它對每一個 WebSocket data message 的 payload 進行獨立的 DEFLATE 壓縮（基於 RFC 1951），並使用 RSV1 位元標記該 message 是否被壓縮。

1. 核心特點

    | 特性 | 說明 |
    | --- | --- |
    | 壓縮範圍 | 只壓縮 data message 的 payload（Text / Binary），控制 frame（Ping / Pong / Close）不壓縮 |
    | 標記方式 | 使用 frame header 的 RSV1 位元（稱為 “Per-Message Compressed” bit） |
    | 壓縮單位 | 整個 message（即使被 fragmentation，也是對整條 message 壓縮後再分割） |
    | 演算法 | DEFLATE（RFC 1951）+ 特殊的尾端處理（來自 RFC 1979 的 byte-boundary alignment） |
    | 記憶體控制 | 透過參數限制 LZ77 sliding window 大小與是否重用壓縮上下文 |

2. 協商參數（Extension Parameters）

    協商時使用四個參數，分別控制雙方向的行為：

    | 參數 | 誰提出 / 影響誰 | 說明 |
    | --- | --- | --- |
    | `server_no_context_takeover` | Client 提出 → 限制 Server | Server 每則 message 後必須重置壓縮上下文（不重用 LZ77 window） |
    | `client_no_context_takeover` | Server 提出 → 限制 Client | Client 每則 message 後必須重置壓縮上下文 |
    | `server_max_window_bits` | Client 提出 → 限制 Server | Server 的 LZ77 sliding window 最大 bits（8–15，對應 256B–32KB） |
    | `client_max_window_bits` | Client 提出 → 限制 Client | Client 的 LZ77 sliding window 最大 bits（通常 8–15） |

    參數規則重點：

    - `*_no_context_takeover` 沒有值（presence-only）
    - `*_max_window_bits` 的值必須是 8–15 的整數
    - Client 可以提出多組不同參數的 offer，Server 選擇其中一組接受
    - Server 回傳的參數必須是 Client 有提出過的

    常見 Client Offer：

    ```http
    Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits
    ```

    Server 接受並加上限制：

    ```http
    Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover
    ```

3. 壓縮與解壓縮流程

    壓縮（Sending side）

    1. 使用 DEFLATE 壓縮整個 message 的 payload
    2. 如果壓縮結果沒有以「空的無壓縮 DEFLATE block」（BTYPE=00）結尾，就追加一個
    3. 移除尾端的 4 個 bytes：`0x00 0x00 0xff 0xff`
    4. 將結果作為 WebSocket frame 的 Payload Data
    5. 在第一個 frame 的 header 設定 RSV1 = 1

    > 這 4 個 bytes 是 zlib/DEFLATE 的 sync flush 標記，移除後接收端可以自己補回去再解壓。

    解壓縮（Receiving side）

    1. 檢查第一個 frame 的 RSV1 是否為 1
    2. 若為 1，把所有 fragment 的 payload 串接起來
    3. 在尾端補回 `0x00 0x00 0xff 0xff`
    4. 用 DEFLATE 解壓縮
    5. 得到原始 payload

    重要細節

    - 一個 message 可以使用多個 DEFLATE block
    - 可以使用 BFINAL=0 或 BFINAL=1 的 block
    - 若使用 BFINAL=1 且沒對齊到 byte boundary，必須補 0 的 padding
    - Fragmentation：壓縮是對整個 message 做的，之後再分割成多個 frame。非最後一個 fragment 不能 移除尾端的 `00 00 FF FF`

4. Context Takeover（上下文重用）

    這是最容易誤解的概念：

    - 有 Context Takeover（預設）：壓縮器會保留上一則 message 的 LZ77 sliding window，用來幫助壓縮下一則 message → 壓縮率較好，但記憶體持續佔用。
    - No Context Takeover：每則 message 結束後清空 sliding window → 記憶體使用更可預測，也比較安全（避免透過壓縮長度洩漏前一則 message 的資訊）。

    實務建議：

    - 高安全性或記憶體敏感的環境 → 開啟 `*_no_context_takeover`
    - 追求最大壓縮率 → 允許 context takeover + 較大的 window bits（15）

5. RSV1 位元的使用規則

    | 情況 | RSV1 |
    | --- | --- |
    | Message 有被壓縮 | 第一個 frame 必須設為 1，後續 fragment 必須為 0 |
    | Message 沒有被壓縮 | 所有 frame 必須為 0 |
    | 控制 frame | 必須為 0 |

    接收端若收到 RSV1=1 但沒有協商成功 `permessage-deflate`，必須`關閉連線`。

6. 實際壓縮範例

    原始文字： `"Hello"`

    壓縮後（移除尾端 4 bytes 前）：

    ```text
    0xf2 0x48 0xcd 0xc9 0xc9 0x07 0x00 0x00 0x00 0xff 0xff
    ```

    移除 `00 00 FF FF` 後作為 payload：

    ```text
    0xf2 0x48 0xcd 0xc9 0xc9 0x07 0x00
    ```

    對應的 WebSocket frame（Server → Client，未 mask）：

    ```text
    C1 07 F2 48 CD C9 C9 07 00
    ```

    - `C1` = FIN=1 + RSV1=1 + Opcode=0x1 (Text)
    - `07` = length=7

7. 記憶體與效能考量

    | Window Bits | Sliding Window 大小 | 記憶體影響 | 壓縮效果 |
    | --- | --- | --- | --- |
    | 8 | 256 B | 極低 | 差 |
    | 10 | 1 KB | 低 | 普通 |
    | 12 | 4 KB | 中等 | 良好 |
    | 15 | 32 KB | 較高 | 最佳 |

    - 預設通常使用 15 bits
    - 大量連線的 server 常會限制 window bits 或強制 `no_context_takeover` 來控制記憶體
    - 很小的 message（例如 < 100 bytes）有時壓縮後反而變大，實作可選擇不壓縮（RSV1=0）

8. 安全性注意事項（RFC 7692 §8）

    - Context takeover 可能讓攻擊者透過觀察壓縮後長度，推斷前一則 message 的內容（CRIME / BREACH 類攻擊的變體）。
    - 建議在處理敏感資料時開啟 `no_context_takeover`。
    - 解壓縮時必須設定合理的輸出大小上限，防止 decompression bomb。

**總結**

permessage-deflate 透過：

1. 協商參數控制雙方向的 window 大小與 context 重用
2. 使用 RSV1 標記壓縮狀態
3. 特殊的 DEFLATE 尾端處理（移除 / 補回 `00 00 FF FF`）

在保持與現有 WebSocket 實作高度相容的同時，有效降低文字與 JSON 類訊息的頻寬消耗。這也是目前幾乎所有主流 WebSocket 函式庫都會實作的壓縮擴展。

## WebSocket Fragmentation Handling (RFC 6455 §5.4)

WebSocket 允許把一則 message 拆成多個 frame 傳送，這稱為 fragmentation（訊息分割）。主要目的是：

- 在訊息總大小還未知時就能開始傳送（例如串流）
- 避免一次緩衝過大的訊息
- 讓中間設備或實作可以彈性處理資料

1. 基本結構規則

    | 類型 | 組成方式 |
    | --- | --- |
    | Unfragmented message | 單一 frame：`FIN = 1`，opcode ≠ 0 |
    | Fragmented message | 1. 第一個 frame：`FIN = 0`，opcode = 0x1 (Text) 或 0x2 (Binary) <br />2. 零或多個中間 frame：`FIN = 0`，opcode = 0x0 (Continuation) <br />3. 最後一個 frame：`FIN = 1`，opcode = 0x0 (Continuation) |

    > 重要：所有 fragment 的資料類型由第一個 frame 的 opcode 決定。後續 continuation frame 的 opcode 必須是 0x0。

2. 官方規則整理（RFC 6455）

    以下是必須遵守的規則：

    1. Unfragmented message.  
       單一 frame，`FIN = 1`，opcode 不是 0。

    2. Fragmented message.  
       以 `FIN = 0` + 非 0 opcode 開頭，中間是 `FIN = 0` + opcode 0x0，最後以 `FIN = 1` + opcode 0x0 結束。
    3. Control frames 可以插入.  
       Ping / Pong / Close 可以插在 fragmented message 的中間。  
       Control frames 本身絕對不能被 fragmentation（必須 `FIN = 1`，且 payload ≤ 125 bytes）。
    4. 順序必須保持.  
       Fragment 必須按照發送順序交付給接收端。
    5. 不能交錯不同 message 的 fragment.  
        一則 message 的 fragment 不能穿插另一則 message 的 fragment（除非有 extension 明確支援這種 interleaving）。
    6. 接收端必須能處理中間插入的 control frame.  
       即使正在組裝一個 fragmented message，也必須能即時處理 Ping/Pong/Close。
    7. Fragment 大小沒有限制.  
       Sender 可以把 non-control message 切成任意大小的 fragment。
    8. 雙方都必須支援.  
       Client 和 Server 都必須能正確接收 fragmented 與 unfragmented message。
    9. 所有 fragment 類型相同.  
       整則 message 的類型由第一個 frame 的 opcode 決定（Text 或 Binary）。

3. 實際範例

    把文字 "Hello World" 拆成三個 fragment：

    ```text
    Frame 1: FIN=0, Opcode=0x1 (Text), Payload="Hel"
    Frame 2: FIN=0, Opcode=0x0 (Continuation), Payload="lo "
    Frame 3: FIN=1, Opcode=0x0 (Continuation), Payload="World"
    ```

    接收端必須把三個 payload 串接成 `"Hello World"`，並以 Text message 交付給應用層。

    中間插入 Ping 的合法序列：

    ```text
    Frame 1: FIN=0, Opcode=0x1, Payload="Hel"
    Frame 2: FIN=1, Opcode=0x9 (Ping), Payload=...     ← 控制 frame 插入
    Frame 3: FIN=0, Opcode=0x0, Payload="lo "
    Frame 4: FIN=1, Opcode=0x0, Payload="World"
    ```

    接收端必須：

    - 立即回應 Ping（回傳 Pong）
    - 繼續累積 data fragment
    - 最後組成完整 message

4. 接收端實作重點（State Machine）

    實作接收邏輯時，通常需要維護以下狀態：

    ```text
    - 是否正在組裝 fragmented message？
    - 原始 opcode（Text / Binary）
    - 已累積的 payload buffer
    - 累積大小（要有上限，防止 memory bomb）
    ```

    處理流程建議：

    | 收到的 Frame | 處理方式 |
    | --- | --- |
    | Data frame + FIN=1 + opcode ≠ 0 | 完整 message，直接交付 |
    | Data frame + FIN=0 + opcode ≠ 0 | 開始新的 fragmented message，記錄 opcode，開始累積 |
    | Continuation + FIN=0 | 追加 payload 到 buffer |
    | Continuation + FIN=1 | 追加最後一段，組成完整 message 並交付，清除狀態 |
    | Control frame（任何時候） | 立即處理（回 Pong、處理 Close 等），不影響 data 組裝 |
    | 非法情況（例如在未開始 fragment 時收到 Continuation） | 視為 protocol error，關閉連線 |

5. 與 Extension 的互動（特別是 permessage-deflate）

    - 壓縮是針對整則 message 做的，而不是針對單一 frame。
    - 壓縮後的資料再被切成多個 fragment。
    - RSV1 只在第一個 frame 上設定（表示整則 message 有被壓縮）。
    - 後續 continuation frame 的 RSV1 必須為 0。
    - 中間設備（proxy）如果不知道 extension 的語意，不能任意改變 fragmentation。

6. 常見錯誤與注意事項

    | 錯誤 | 後果 |
    | --- | --- |
    | 在 fragmented message 中間開始新的 data message | Protocol error |
    | Control frame 被拆成多個 frame | Protocol error |
    | Continuation frame 出現在沒有進行中的 message | Protocol error |
    | 不處理中間插入的 Ping | 可能導致連線被對端關閉（keepalive 失敗） |
    | 沒有限制累積 buffer 大小 | 容易被大 fragment 攻擊造成 OOM |
    | 假設 frame 邊界有意義 | 在沒有 extension 的情況下，不應依賴特定 frame 邊界 |

7. 為什麼需要 Fragmentation？

    - 串流場景：產生資料的同時就能開始傳送，不必等全部資料準備好。
    - 記憶體限制：避免一次把超大訊息全部載入記憶體。
    - 即時性：大檔案傳輸時仍可穿插 Ping/Pong 維持連線活性。
    - 中間設備友善：允許 proxy 在不理解應用資料的情況下，合理切割或合併 frame（但有限制）。

**總結**

WebSocket 的 fragmentation 設計相當嚴謹：

- 用 FIN + Opcode 清楚標示 message 的開始與結束
- 允許 control frame 插入，保證 keepalive 與關閉能即時處理
- 禁止不同 message 的 fragment 交錯
- 強制接收端必須同時支援 fragmented 與 unfragmented 兩種形式

正確實作時，接收端需要維護「正在組裝中的 message」狀態，並在收到最終 `FIN=1` 的 continuation frame 後，把所有 payload 串接成一則完整的 message 交給應用層。

## 注意事項

### WebSocket

- 協定層的 ping/pong（伺服器偵測客戶端）.  

    WebSocket 協定內建 ping 和 pong 兩種控制 frame。伺服器送出 ping，`瀏覽器會由網路層自動回 pong`，不需要任何前端程式碼，也不經過 JavaScript 主執行緒。所以就算頁面的 JS 很忙，或分頁在背景被節流，pong 照樣會回。

    伺服器的邏輯很簡單：定期送 ping，下一輪檢查時若還沒收到 pong，就判定對方已死。用 Node 的 `ws` 套件時，標準寫法如下：

    ```javascript
    import { WebSocketServer } from 'ws'

    const wss = new WebSocketServer({ port: 8080 })

    wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    })

    const interval = setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) {
        ws.terminate() // 不要用 close()，原因見下方
        continue
        }
        ws.isAlive = false
        ws.ping()
    }
    }, 30_000)

    wss.on('close', () => clearInterval(interval))
    ```

    這樣最多兩個週期（約 60 秒）就能清掉殭屍連線，和 TCP 層要等的十幾分鐘相比快很多。

    為什麼要用 `terminate()` 而不是 `close()`？ `close()` 會執行正規的關閉交握：送出 close frame，然後`等對方回應` close frame。對方已經不存在了，這個交握永遠等不到回應，連線會卡在 CLOSING 狀態一段時間。`terminate()` 則是`直接銷毀 socket`，立刻釋放資源，並觸發 close 事件讓你清理訂閱等資源。

## 常見問題

### 有沒有可能用戶端其實已經斷線了，但Server端(sse或websocket)仍然以為用戶保持連線？

會，而且相當常見。伺服器通常要到下一次寫入失敗才會發現連線已斷，在那之前可能好幾分鐘、甚至更久，都還把這條連線當成活的。這種狀態叫做 half-open connection（半開連線）。

反方向的問題也存在：伺服器或中間網路斷了，但瀏覽器的 ws.readyState 仍然是 OPEN，onclose 遲遲不觸發，畫面上的資料就靜止不動。

#### 為什麼會發生

TCP 連線正常關閉時，客戶端會送出 FIN 或 RST 封包，伺服器收到後就知道連線斷了，Node 的 req.on('close') 或 h3 的 onClosed 也會觸發。問題在於很多斷線情境下，這個封包根本沒機會送出去：

- 手機在 Wi-Fi 與行動網路之間切換，或進入電梯、隧道
- 筆電闔上進入睡眠
- 瀏覽器被系統強制終止，或 iOS 把背景分頁凍結
- 路由器或 NAT 的連線表逾時，悄悄把對應關係丟掉
- 網路線被拔掉、基地台訊號消失

#### 為什麼寫入了也不會馬上發現

即使你有在送資料，偵測仍可能有延遲，原因有三：

1. 寫入只是寫進 kernel 的傳送緩衝區

    write() 成功只代表資料進了作業系統的 send buffer，不代表對方收到。TCP 會在背景重傳，要等重傳次數用完才判定失敗。Linux 預設 `tcp_retries2 = 15`，大約要 15 分鐘左右才會放棄並回報錯誤。在這段期間，你的程式完全不知道對方已經不在。

2. TCP keepalive 預設太慢

    作業系統的 TCP keepalive 預設在連線閒置 2 小時後才開始探測，對即時推播來說等於沒有。

3. 中間層把斷線藏起來

    如果架構是「瀏覽器 → Nginx / 負載平衡器 → Node」，Node 看到的其實是 Nginx 到 Node 這一段連線。客戶端那段斷了，Nginx 不一定會立刻關閉上游連線，而且 Nginx 本身也可能 buffer 資料，讓你的寫入看起來一直成功。

#### 解法

1. 伺服器定期送心跳
2. 調整 TCP 層參數.  
    縮短作業系統放棄連線的時間：
    ```javascript
    // Node：在取得 socket 後設定
    socket.setKeepAlive(true, 30_000)
    ```

    在 Linux 上也可以調整 TCP_USER_TIMEOUT（socket 選項），讓有未確認資料時，最多等指定時間就判定斷線，而不是等十幾分鐘。

    也要檢查 Nginx 的 proxy_read_timeout，以及雲端負載平衡器的 idle timeout（例如 AWS ALB 預設 60 秒），確保心跳間隔比這些逾時短。

3. 應用層「客戶端回報存活」：唯一可靠的做法

    如果真的需要準確知道使用者是否在線（例如在線人數、在線狀態），就不能只靠伺服器單方面推送，必須讓客戶端主動證明自己還活著

4. 客戶端也要偵測「伺服器那端死掉」

    - websocket: 瀏覽器的 JavaScript 無法送 `ping frame`，也看不到 `pong`，協定層的機制對前端完全不可見。這和 SSE 的註解行心跳是同一個陷阱。所以前端要偵測伺服器是否存活

5. 行動裝置的額外處理

    手機瀏覽器切到背景時，頁面常會被凍結或連線被系統切斷。使用者切回來時，websocket readyState 可能短暫仍顯示 OPEN，但連線其實早就死了。建議監聽這兩個事件，主動檢查並重連：
    ```javascript
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // 送一個應用層 ping，短時間內沒回應就重連
        }
    })

    window.addEventListener('online', () => {
        // 網路恢復，直接重連比較保險
    })
    ```

    另外要注意，背景分頁的計時器可能被`瀏覽器節流`。如果是設計「客戶端定期送心跳給伺服器」，背景分頁的心跳可能延遲送出，導致伺服器誤判斷線。所以伺服器端的存活判斷，最好以伺服器主動送的協定層 ping 為主，因為瀏覽器回 pong 不受 JS 計時器節流影響。

### 有沒有可能server端其實已經斷線了，但用戶端仍然以為與server端保持連線？

會，而且這個方向的問題對使用者的影響通常更直接：畫面上的資料停在某個時間點不再更新，但介面看起來一切正常。瀏覽器的 `readyState` 仍顯示連線中，`onclose` 和 `onerror` 都不會觸發。

#### 什麼情況下會發生

不會發生的情況（容易誤解）：伺服器的程式當掉或被 kill 時，只要那台機器的作業系統還活著，kernel 會替這個程式關閉所有 socket 並送出 FIN 或 RST，客戶端很快就會收到 onclose。所以單純的程式崩潰通常不是問題。

真正會造成無聲斷線的情況：

- 整台機器消失：斷電、kernel panic、VM 被凍結或遷移，沒有任何封包送出
- 網路路徑中斷：中間某段網路壞掉，雙方都不知道
- 客戶端自己的網路出問題：連著 Wi-Fi 但實際上沒有對外網路（例如公共 Wi-Fi 的登入頁），或家用路由器的 NAT 對應被清掉，伺服器送來的封包在路上就被丟棄
- 中間層吞掉了後端的斷線：客戶端實際上連的是負載平衡器或 CDN。後端無聲死掉時，負載平衡器和客戶端之間那段連線完全正常，客戶端看到的是一個健康的 proxy，卻永遠等不到資料

#### 為什麼客戶端特別難發現

關鍵在於：只讀不寫的一方，永遠偵測不到斷線。

TCP 只有在送資料時，才會因為收不到確認而觸發重傳，最終回報錯誤。如果一方只是在等待接收，連線上沒有任何動靜，那「對方很久沒說話」和「對方已經不存在」在 TCP 層看起來完全一樣，讀取不會失敗，只會一直等下去。

- SSE 是最糟的情況：`EventSource` 從頭到尾只讀不寫，在 TCP 層根本沒有機會發現斷線
- WebSocket 稍好一點：客戶端可以主動送訊息，促使 TCP 層最終發現問題，但瀏覽器回報錯誤可能仍要好幾分鐘

另外，`navigator.onLine` 不可靠。它只代表裝置有任何網路介面連著，不代表真的能連到你的伺服器。

#### 更隱蔽的情況：連線健康，但伺服器已經「腦死」

還有一種情況是 TCP 連線完全正常，伺服器程式也還活著，但資料管線壞了：

- Node 的 event loop 被某個同步運算卡住
- 伺服器和 Redis Pub/Sub 的訂閱悄悄斷掉，更新的數據再也送不進來
- 某段處理邏輯死鎖或拋出未捕捉的錯誤，推送流程停止

這時如果心跳是由連線處理函式裡的一個本地計時器產生，心跳會照常送達，客戶端的 watchdog 也就一直覺得沒事，但真正的業務資料早就停了。

所以心跳的設計要注意：心跳應該盡量走和業務資料相同的路徑。例如讓上游的資料服務定期發出心跳，經過 Redis Pub/Sub、經過推送服務，最後抵達客戶端。這樣心跳正常就代表整條管線都正常。

#### 解法

1. 接收端 watchdog（被動偵測）

    前面 SSE 和 WebSocket 的範例都提過：超過預期時間沒收到任何訊息（包括心跳），就主動關閉並重連。這是最基本、兩者都適用的防線。

2. 主動探測（WebSocket 才能做到）

    watchdog 要等逾時才會觸發。在某些時機點，可以主動送一個應用層 ping，短時間內沒收到 pong 就立刻重連，不必乾等：

    ```javascript
    function probe(timeout = 5_000) {
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), timeout)
            pendingPong = () => { clearTimeout(timer); resolve(true) }
            ws.send(JSON.stringify({ type: 'ping' }))
        })
    }

    // 使用者切回分頁、網路恢復、或即將下注前
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && !(await probe())) {
            reconnect()
        }
    })
    ```

    SSE 沒辦法在同一條連線上探測，只能另外發一個 HTTP 請求確認伺服器狀態，或乾脆在這些時機點直接重連。

3. 序號檢查

    讓每則業務訊息帶一個遞增序號，客戶端檢查有沒有跳號：

    ```javascript
    let lastSeq = 0

    function onOddsUpdate(msg: { seq: number; data: any }) {
    if (lastSeq && msg.seq !== lastSeq + 1) {
        // 中間漏了訊息，重新拉完整快照
        resync()
    }
    lastSeq = msg.seq
    applyUpdate(msg.data)
    }
    ```

    這同時解決了「重連期間漏掉的訊息」問題。SSE 可以直接把序號放在 `id:` 欄位，搭配 `Last-Event-ID` 讓伺服器補發。

4. 介面上顯示資料狀態

    客戶端無法保證永遠即時，所以要讓使用者知道資料可能過期：

    顯示連線狀態指示，例如連線中、重連中、已斷線
    某數據超過一段時間沒更新，就標示為可能過期

5. 伺服器端永遠要驗證（最重要）
6. 伺服器部署時主動關閉連線

    很多「伺服器斷線」其實發生在部署或重啟時。伺服器關機前應該先主動關閉所有連線，而不是直接消失：

    - WebSocket 送出 close frame，code 用 1001（Going Away）或 1012（Service Restart）
    - SSE 直接結束 response

    這樣客戶端會立刻收到通知，轉去重連其他還活著的實例。

    同時要注意，大量客戶端在同一瞬間斷線後，會同時重連，形成雷群效應把新的伺服器打垮。重連的退避時間一定要加上隨機抖動：

    ```javascript
    const base = Math.min(1000 * 2 ** retry, 30_000)
    const delay = base / 2 + Math.random() * (base / 2)
    setTimeout(connect, delay)
    ```

#### 總結

| 情況 | 客戶端能否自動發現 | 對策 |
| -- | -- | -- |
| 伺服器程式崩潰，機器仍在 | 能，很快收到 `onclose` | 正常重連即可 |
| 機器消失、網路中斷 | SSE 幾乎不能；WebSocket 很慢 | watchdog、主動探測 |
| 伺服器活著，資料管線壞了 | 不能 | 端到端心跳、序號檢查 |
| 部署重啟 | 取決於伺服器有沒有主動關閉 | 優雅關機、重連加隨機抖動 |