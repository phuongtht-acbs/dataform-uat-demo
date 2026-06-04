# Tài liệu Hướng dẫn Dự án Dataform

Repository này chứa mã nguồn và luồng biến đổi dữ liệu qua Dataform trên Google Cloud BigQuery. Dự án áp dụng kiến trúc 3 lớp (Bronze -> Silver -> Gold).

---

## 1. Kiến trúc Dữ liệu

Hệ thống chia làm 3 lớp:

1. **Lớp Bronze (dữ liệu thô):** Chứa các bảng dữ liệu thô đồng bộ từ hệ thống. Khai báo bảng mới tại file `definitions/external_sources.js`.
2. **Lớp Silver (clean và hình thành dữ liệu normalized):**
   * **Stage Views/Tables (`stage_*`):** Chuẩn hóa dữ liệu thô bằng cách xóa ký tự lỗi, sửa định dạng ngày, và lọc trùng bằng lệnh `QUALIFY ROW_NUMBER()`.
   * **Dimensions (`dim_*`):** Lưu lịch sử thay đổi đối tượng dạng SCD Type 7 (tham khảo tại https://en.wikipedia.org/wiki/Slowly_changing_dimension#Type_7:_Hybrid_-_Both_surrogate_and_natural_key).
   * **Facts (`fact_*`):** Lưu các bảng giao dịch (ví dụ: lệnh mua bán chứng khoán, lệnh chuyển tiền), hoặc các bảng snapshot.
   * **Bảng phụ trợ:** File `bronze_checkpoint` theo dõi ngày nạp dữ liệu và `dim_attribute_lookup` tra cứu danh mục mã lỗi.
3. **Lớp Gold (hình thành dữ liệu đã denormalized):**
   * **History Tables (`*_history`):** Bảng chứa dữ liệu lịch sử các đối tượng theo kiểu SCD7, sau đó được denormalize thêm history key của các đối tượng.
   * **Current Views (`subaccount`, `customer`):** View chứa trạng thái mới nhất (`WHERE is_current = true`) của đối tượng.
   * **Fact Tables:** Bảng fact được denormalize thêm history key của các đối tượng, phục vụ mô hình Star Schema.

---

## 2. Vận hành

### 2.1 Biến số Hệ thống
File `workflow_settings.yaml` có 1 biến điều khiển phạm vi dữ liệu:
* `target_date`: Ngày xử lý dữ liệu cho chế độ Incremental. Nếu trống thì tự động lấy ngày lớn nhất từ lớp Bronze.

### 2.2 Câu lệnh thực thi
```bash
Chưa cấp quyền nên chưa test được.
```

---

## 3. Thêm Dữ Liệu Mới

Quy trình gồm 4 bước:

### Bước 1: Thêm nguồn tại Bronze
Thêm dòng khai báo vào file `definitions/external_sources.js`:
```javascript
declare({ schema: 'bronze', name: "TEN_BANG_NGUON_MOI" });
```

### Bước 2: Cập nhật bronze_checkpoint và dim_attribute_lookup
* Thêm `"TEN_BANG_NGUON_MOI"` vào `tables_to_track` trong file `definitions/silver/bronze_checkpoint.sqlx`.
* Thêm các giá trị lookup từ file docs excel vào `excel_metadata` trong file `definitions/silver/dim_attribute_lookup.sqlx`.

### Bước 3: Tạo file Stage (`definitions/silver/stage_*.sqlx`)
* Đối với các đối tượng đang lấy dữ liệu từ các bảng bị lệch snapshot_date và business_date thì cần tạo bảng incremental như file `stage_subaccount.sqlx`.
* Đối với các thực thể bình thường, tạo file mới bằng cách copy từ file sẵn có và điền theo hướng dẫn.


### Bước 4: Tạo file SCD7 (`dim_*`) hoặc file Fact
* Sao chép từ các file dim và fact tương ứng và điền theo hướng dẫn.
* Cấu hình chính xác các khóa `natural_key`, `tech_key`, và `surrogate_key`.

### Bước 5: Tạo file ở lớp Gold
* Đối với đối tượng ở bảng dim, cần tạo 1 file `*_history.sqlx` và 1 file `*.sqlx` (copy từ mẫu). Bảng nào nặng quá thì tạo kiểu table, còn không thì cứ view.
* Đối với bảng fact kiểu giao dịch, chỉ cần 1 file dạng `*.sqlx`. Nhớ định nghĩa đầy đủ các đối tượng để denormalize vào bảng.
* Đối với bảng fact kiểu snapshot, cần tạo 1 file để lưu lịch sử snapshot (tên có chứa chữ `daily`) và 1 file để lưu lịch sử tính đến hiện tại (accumulating snapshot, tên có chứa chữ `current`). Bảng accumulating snapshot giúp lưu được dữ liệu cho các đối tượng có dữ liệu nguồn ở bronze ngưng trả dữ liệu khi đối tượng inactive (ví dụ debit_contract).

---

## 4. Maintain

### 4.1 Thư viện Dùng chung (`includes/func.js`)
Mọi hàm chuyển đổi, logic MERGE, và cập nhật checkpoint nằm tại file này:
* `cleanNullString(col)`: Chuyển chuỗi lỗi (`'NULL'`, `'N/A'`) thành giá trị `NULL` thực tế.
* `guardScd7Timeline(isIncremental, selfRef)`: Dừng nạp nếu `target_date` nhỏ hơn hoặc bằng `max(valid_from)` hiện tại để tránh lỗi đè dòng thời gian.

### 4.2 Kiểm tra Chất lượng Dữ liệu (Assertions)
Hệ thống sử dụng hai nhóm kiểm tra:
1. **Kiểm tra Dữ liệu Đầu Vào:** file `bronze_snapshot_date_check.sqlx` và `bronze_business_date_check.sqlx` quét bảng thô lớp Bronze. Nếu thiếu dữ liệu ngày tính toán, luồng sẽ dừng để tránh sai số.
2. **Kiểm tra Chiều Lịch Sử (SCD7):** Hàm `checkScd7Dimension` trong thư mục `definitions/assertion/dim_*.sqlx` xác thực quy tắc dòng thời gian (`is_current`, `valid_to`, `valid_from`) và tính duy nhất của khóa Surrogate Key.