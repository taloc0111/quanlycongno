// Nội dung trang "Hướng dẫn sử dụng" (#help, #help/<id>). Chỉ dữ liệu, không có component.
// Quy ước: **chữ đậm** = đúng tên nút / ô / menu trên giao diện. Id chủ đề cố định: các trang
// trỏ tới bằng <PageHeader help="<id>" /> và field `helpTopic` trong modules/serviceConfigs.jsx.
// Khối nội dung: { type: 'p', text } | { type: 'steps', items } | { type: 'tips', items } | { type: 'warn', text }.
// roles: chỉ hiện với các role này. feature: chỉ hiện khi tài khoản được bật tính năng.
// page: key menu (AppLauncher NAV) để nút "Mở trang này" điều hướng tới.

export const HELP_GROUPS = [
  { id: 'start', label: 'Bắt đầu' },
  { id: 'sell', label: 'Bán vé & công nợ' },
  { id: 'collect', label: 'Thu tiền khách' },
  { id: 'money', label: 'Dòng tiền' },
  { id: 'customers', label: 'Khách hàng' },
  { id: 'tools', label: 'Tiện ích' },
  { id: 'admin', label: 'Quản lý' },
  { id: 'faq', label: 'Hỏi đáp' },
];

export const HELP_TOPICS = [
  // ------------------------------------------------------------------ Bắt đầu
  {
    id: 'start',
    group: 'start',
    title: 'Bắt đầu nhanh',
    summary: 'Năm bước làm một lần là bạn dùng được hằng ngày: tài khoản ngân hàng, nhà cung cấp, vé đầu tiên, ghi tiền khách trả và xem Tổng quan.',
    page: 'dashboard',
    body: [
      { type: 'p', text: 'Mỗi trang đều có nút **?** cạnh tiêu đề (**Hướng dẫn trang này**) để mở đúng phần hướng dẫn của trang đó.' },
      {
        type: 'steps',
        items: [
          'Thêm tài khoản ngân hàng: vào menu **Tài khoản** → **Thêm tài khoản**. Nhập **Tên tài khoản** (vd "TCB chính"), **Ngân hàng / ví**, **Số tài khoản**, **Chủ tài khoản**.',
          'Thêm nhà cung cấp: vào **Nhà cung cấp** → **Thêm nhà cung cấp**. Ở ô **Loại** chọn **F1 (đại lý cấp trên)** cho nơi xuất vé, **Bên down (xuất giảm)** cho người làm vé down.',
          'Thêm vé đầu tiên: vào **Công nợ vé** → **Thêm vé**. Nhập **Tên khách hàng**, **Tiền vé / giá bán**, khối **Giá vốn**, rồi bấm **Thêm mới**.',
          'Ghi tiền khách trả: trên dòng vé bấm nút **Thanh toán**, nhập **Số tiền**, chọn **Vào tài khoản**, bấm **Thêm thanh toán**.',
          'Mở **Tổng quan** để xem doanh số, lợi nhuận, ai còn nợ và **Việc cần làm**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Khách được tạo tự động khi bạn gõ tên khách mới lúc thêm vé.',
          'Đã có danh sách vé trong Excel? Dùng nút **Import** ở trang Công nợ vé.',
        ],
      },
    ],
    related: ['debts', 'accounts', 'suppliers', 'payments'],
    keywords: ['bắt đầu', 'mới dùng', 'làm quen', 'checklist', 'cài đặt ban đầu'],
  },

  // ------------------------------------------------------------------ Bán vé & công nợ
  {
    id: 'debts',
    group: 'sell',
    title: 'Công nợ vé máy bay',
    summary: 'Ghi từng vé đã xuất: giá bán, giá vốn, tiền khách đã trả và số còn nợ. Đây là trang bạn dùng nhiều nhất.',
    page: 'debt',
    body: [
      {
        type: 'steps',
        items: [
          'Bấm **Thêm vé**. Nhập **Tên khách hàng** (chọn khách cũ hoặc gõ tên mới), **Mã vé**, **Hãng bay**, **Hành trình**, **Ngày bay**.',
          'Nhập **Tiền vé / giá bán** và khối **Giá vốn** (xem chủ đề Giá vốn nhiều khoản & Vé down).',
          'Khách đã chuyển tiền trước: nhập ô **Trả trước** và chọn **Vào tài khoản** là tài khoản nhận tiền. Bấm **Thêm mới**.',
          'Sửa vé: bấm nút **Sửa** trên dòng. Xoá: bấm **Xoá**. Xoá nhiều vé: tích ô đầu các dòng rồi bấm **Xoá đã chọn**.',
          'Lọc: chọn tháng (**Mọi tháng**), tình trạng trả tiền (**Còn nợ**, **Quá hạn**, **Đã trả đủ**) hoặc gõ vào ô tìm kiếm. Bấm **Xoá lọc** để bỏ lọc.',
          'Nút **Cột** để ẩn/hiện cột như **Giá gốc**, **Nợ NCC**, **Check-in**. Nút **Excel** tải bảng đang lọc về máy.',
          'Nhập từ file: bấm **Import** → **Tải file mẫu** → điền dữ liệu → **Chọn file Excel/CSV** → kiểm tra phần **Ghép cột dữ liệu** → bấm nút **Import** (kèm số dòng).',
        ],
      },
      {
        type: 'tips',
        items: [
          'Nút **Hành trình** lưu các chặng hay bán để gõ nhanh; nút **Công ty** quản lý khách doanh nghiệp và hạn mức nợ.',
          'Bấm thẻ **Còn nợ** để xem ai còn nợ; bấm thẻ **Quá hạn** để lọc vé quá hạn.',
          'Sau khi lưu, ô **Đã trả** bị khoá: dùng nút **Thanh toán** để ghi các lần trả tiếp theo.',
          'Dòng có nhãn **Chỉ xem** là của đại lý cấp dưới, bạn không sửa được.',
        ],
      },
    ],
    related: ['cost', 'payments', 'cancel', 'change', 'customers'],
    keywords: ['thêm vé', 'vé máy bay', 'nhập vé', 'sửa vé', 'xoá vé', 'excel', 'import', 'lọc', 'cột', 'hành trình', 'công ty', 'trả trước', 'mã vé'],
  },
  {
    id: 'cost',
    group: 'sell',
    title: 'Giá vốn nhiều khoản & Vé down',
    summary: 'Khi giá vốn gồm nhiều khoản trả cho nhiều người (F1, bên down…), chia ra từng dòng để biết còn nợ ai bao nhiêu.',
    page: 'debt',
    body: [
      { type: 'p', text: '**Vé down** (vé đạo, vé xuất giảm) có giá vốn gồm 3 khoản: phí bên down, giá vé F1 và phí F1. Mỗi khoản trả cho một người khác nhau.' },
      {
        type: 'steps',
        items: [
          'Trong form vé, ở khối **Giá vốn**, chọn **Loại vé** là **Vé down**. Hệ thống tự thêm 3 dòng: **Giá vé F1**, **Phí F1** (5.000đ) và **Phí down**.',
          'Nhập số tiền từng dòng và chọn nhà cung cấp. Chưa có thì chọn **+ Thêm nhà cung cấp…** ngay trong ô chọn.',
          'Vé thường mà giá vốn có nhiều khoản: bấm **Chia nhiều khoản**, rồi **Thêm dòng** cho từng khoản.',
          'Đã chuyển tiền cho nhà cung cấp lúc nhập vé: tích **Trả ngay** ở dòng đó và chọn tài khoản chi tiền.',
          'Lưu vé. **Tổng giá vốn** là tổng các dòng; phần chưa trả hiện ở cột **Nợ NCC** và trang **Nhà cung cấp**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Dòng **Giá vé F1** và **Phí F1** tự chọn nhà cung cấp loại F1 đầu tiên, **Phí down** tự chọn bên down đầu tiên. Có nhiều F1 thì kiểm tra lại.',
          'Bấm biểu tượng lịch (**Đặt hạn trả NCC**) để ghi hạn trả nhà cung cấp; khoản sắp đến hạn hiện ở Tổng quan.',
          'Dòng đã trả tiền cho nhà cung cấp thì không đổi được nhà cung cấp nữa.',
        ],
      },
    ],
    related: ['suppliers', 'cost-pending', 'debts'],
    keywords: ['vé down', 'vé đạo', 'vé xuất giảm', 'xuất giảm', 'giá vốn', 'giá gốc', 'f1', 'phí f1', 'phí down', 'chia nhiều khoản', 'trả ngay', 'nhà cung cấp', 'ncc'],
  },
  {
    id: 'cost-pending',
    group: 'sell',
    title: 'Chưa đủ giá vốn',
    summary: 'Đánh dấu vé chưa biết đủ giá vốn để lợi nhuận không bị tính sai. Vé vẫn tính doanh số và công nợ bình thường.',
    page: 'debt',
    body: [
      { type: 'p', text: 'Khách chuyển tiền trước mà bạn chưa biết giá vốn cuối cùng? Cứ nhập vé và để công tắc **Chưa đủ giá vốn (chưa tính lãi)** bật. Cột **Lợi nhuận** của vé hiện **Chưa tính**.' },
      {
        type: 'steps',
        items: [
          'Khi thêm vé mới mà giá vốn để trống (hoặc có dòng giá vốn bằng 0), công tắc **Chưa đủ giá vốn (chưa tính lãi)** tự bật.',
          'Xem các vé đang chờ: chọn bộ lọc **Chưa đủ giá vốn** trên trang, bấm thẻ **Lợi nhuận**, hoặc xem mục **Chưa đủ giá vốn** ở Tổng quan.',
          'Khi biết giá vốn: bấm **Sửa**, nhập đủ giá vốn, tắt công tắc **Chưa đủ giá vốn (chưa tính lãi)** rồi bấm **Lưu thay đổi**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Khi sửa vé, công tắc không tự tắt: nhập đủ giá vốn xong bạn phải tự tắt.',
          'Thẻ **Lợi nhuận** ghi rõ đang không tính bao nhiêu dòng chưa đủ giá vốn.',
        ],
      },
    ],
    related: ['cost', 'faq'],
    keywords: ['chưa đủ giá vốn', 'chưa tính lãi', 'lãi sai', 'lợi nhuận', 'nhập giá vốn sau'],
  },
  {
    id: 'cancel',
    group: 'sell',
    title: 'Huỷ / hoàn vé và Hoàn tác huỷ',
    summary: 'Huỷ vé, ghi phí khách chịu, trả lại tiền thừa cho khách và ghi tiền nhà cung cấp hoàn. Ghi nhầm thì Hoàn tác huỷ.',
    page: 'debt',
    body: [
      {
        type: 'steps',
        items: [
          'Trên dòng vé bấm **Thao tác khác** (dấu ⋯) → **Huỷ / hoàn**.',
          'Nhập **Ngày huỷ** và **Khách chịu (phí huỷ/hoàn)**: số tiền khách vẫn phải trả sau khi huỷ.',
          '**Trả lại khách** tự tính = đã trả − phí khách chịu. Ở **Trả vào** chọn **Ví khách** (giữ cho lần sau) hoặc **Tài khoản**, rồi chọn **Chi từ tài khoản**.',
          'Nhà cung cấp hoàn tiền cho mình: phần **NCC hoàn lại** đã có sẵn 1 dòng cho mỗi NCC của vé, số tiền để trống (ô có ghi giá vốn để tham khảo). Nhập đúng số NCC thật sự hoàn; NCC không hoàn thì để trống. NCC khác thì bấm **Thêm dòng**. Đã nhận tiền thì tích **Đã nhận tiền?** và chọn tài khoản nhận.',
          'Xem trước **Doanh thu sau huỷ**, **Giá vốn còn lại**, **Lãi/lỗ**, rồi bấm **Xác nhận huỷ**.',
        ],
      },
      { type: 'warn', text: 'Ghi nhầm? Bấm **Thao tác khác** → **Hoàn tác huỷ**. Vé về như trước khi huỷ; các khoản hoàn tiền khách và NCC hoàn ghi lúc huỷ bị xoá.' },
      {
        type: 'tips',
        items: [
          'Vé đã huỷ bị ẩn khỏi bảng. Chọn bộ lọc **Đã huỷ** hoặc **Trạng thái: Tất cả** để xem lại.',
          'Vé đã huỷ mà khách còn nợ phí huỷ vẫn bấm **Thanh toán** được để thu phần phí đó.',
          'Chưa nhận tiền NCC hoàn lúc huỷ? Sau này vào **Nhà cung cấp**, mở NCC đó và bấm **Nhận** ở dòng hoàn.',
        ],
      },
    ],
    related: ['payments', 'wallets', 'suppliers', 'faq'],
    keywords: ['huỷ vé', 'hủy vé', 'hoàn vé', 'hoàn tiền', 'phí huỷ', 'hoàn tác', 'khôi phục', 'ncc hoàn', 'f1 hoàn', 'trả lại khách'],
  },
  {
    id: 'change',
    group: 'sell',
    title: 'Đổi vé',
    summary: 'Ghi lần đổi ngày bay, hành trình hoặc mã vé, cùng phí đổi thu khách và phí đổi trả nhà cung cấp.',
    page: 'debt',
    body: [
      {
        type: 'steps',
        items: [
          'Trên dòng vé máy bay bấm **Thao tác khác** (dấu ⋯) → **Đổi vé**.',
          'Nhập **Ngày đổi** và những gì thay đổi: **Ngày bay mới**, **Hành trình mới**, **Mã vé mới** (ô nào không đổi thì bỏ trống).',
          '**Phí đổi thu khách** được cộng vào giá bán. **Phí đổi trả NCC** thêm 1 dòng giá vốn "Phí đổi vé"; chọn **NCC thu phí đổi**.',
          'Xem **Giá bán mới**, **Giá vốn mới**, **Lãi** rồi bấm **Lưu đổi vé**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Lần đổi được tự ghi vào **Ghi chú** của vé để tra lại sau.',
          'Đổi vé không có nút hoàn tác: nếu ghi nhầm, bấm **Sửa** để chỉnh lại giá bán và dòng giá vốn "Phí đổi vé".',
          'Chỉ vé máy bay mới có **Đổi vé**.',
        ],
      },
    ],
    related: ['debts', 'cost', 'payments'],
    keywords: ['đổi vé', 'đổi ngày bay', 'đổi chặng', 'phí đổi', 'đổi hành trình', 'đổi giờ bay'],
  },
  {
    id: 'other-services',
    group: 'sell',
    title: 'Vé tàu, Hộ chiếu, Tour',
    summary: 'Ba loại dịch vụ này dùng giống trang Công nợ vé máy bay: thêm, thanh toán, giá vốn, huỷ / hoàn, Excel.',
    body: [
      { type: 'p', text: 'Mọi thao tác (Thanh toán, giá vốn nhiều khoản, Chưa đủ giá vốn, Huỷ / hoàn, Import, Excel) giống vé máy bay. Chỉ khác các ô nhập:' },
      {
        type: 'steps',
        items: [
          '**Vé tàu hỏa** → **Thêm vé tàu**: **Số tàu**, **Hành trình**, **Loại chỗ**, **Ngày đi**, **Giá bán**.',
          '**Hộ chiếu** → **Thêm hồ sơ**: **Số hộ chiếu**, **Địa chỉ**, **Ngày làm**, **Tổng tiền**.',
          '**Du lịch** → **Thêm tour**: **Tên tour / điểm đến**, **Ngày đi**, **Ngày về**, **Số khách**, **Trạng thái** (Tư vấn, Đã cọc, Đã đi, Huỷ), **Giá bán (tổng)**.',
        ],
      },
      {
        type: 'tips',
        items: [
          '**Loại vé** (Vé down) và **Đổi vé** chỉ có ở vé máy bay.',
          'Tour lọc theo tiến độ bằng ô **Mọi trạng thái**.',
          'Mọi giao dịch của một khách (cả 4 loại) gom lại ở trang chi tiết khách hàng.',
        ],
      },
    ],
    related: ['debts', 'payments', 'cancel', 'customers'],
    keywords: ['vé tàu', 'tàu hỏa', 'hộ chiếu', 'passport', 'tour', 'du lịch', 'đặt cọc', 'hồ sơ'],
  },
  {
    id: 'upcoming',
    group: 'sell',
    title: 'Sắp bay & check-in',
    summary: 'Danh sách khách sắp bay lấy từ Ngày bay trong Công nợ vé, để nhắc khách check-in đúng hạn.',
    page: 'upcoming',
    body: [
      {
        type: 'steps',
        items: [
          'Mở **Sắp bay**. Chọn khoảng: **Hôm nay**, **Ngày mai**, **7 ngày**, **30 ngày** hoặc **Tất cả sắp tới**.',
          'Bật **Chỉ chưa check-in** để chỉ thấy khách cần nhắc.',
          'Bấm **Web check-in** để mở trang check-in của hãng.',
          'Check-in xong thì gạt công tắc **Đã check-in** của khách đó.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Số trên menu **Sắp bay** là số khách bay ngày mai chưa check-in.',
          'Vé phải có **Ngày bay** thì mới hiện ở đây.',
        ],
      },
    ],
    related: ['debts'],
    keywords: ['check-in', 'checkin', 'sắp bay', 'ngày bay', 'nhắc khách', 'bay ngày mai'],
  },

  // ------------------------------------------------------------------ Thu tiền khách
  {
    id: 'payments',
    group: 'collect',
    title: 'Ghi nhận thanh toán',
    summary: 'Mỗi lần khách trả tiền cho một vé, ghi lại số tiền, hình thức và tài khoản nhận để công nợ và số dư luôn đúng.',
    page: 'debt',
    body: [
      {
        type: 'steps',
        items: [
          'Trên dòng vé bấm nút **Thanh toán**.',
          'Nhập **Số tiền** (bấm **Trả hết** để điền đúng số còn nợ) và **Ngày**.',
          'Chọn **Hình thức**: **Chuyển khoản**, **Tiền mặt**, **Momo** hoặc **Trừ ví trả trước**.',
          'Chọn **Vào tài khoản**: tài khoản đã nhận tiền.',
          '**Tiền này tính cho**: để **Của mình**; chọn **Của cấp trên (tính vào nộp quỹ)** nếu khách chuyển thẳng cho đại lý cấp trên.',
          'Bấm **Thêm thanh toán**. Các lần trả hiện ngay bên dưới.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Khách trả thừa: phần thừa tự vào ví khách (có dòng báo "Phần thừa … sẽ vào ví khách").',
          '**Trừ ví trả trước** hiện số dư ví; vượt số dư thì không ghi được.',
          'Ghi nhầm: bấm biểu tượng thùng rác (**Xoá**) ở lần trả đó rồi ghi lại. Lần trừ ví bị xoá thì tiền trả lại vào ví.',
          'Lần trả có nhãn **Phiếu thu #…** thì phải xoá phiếu thu ở trang chi tiết khách.',
        ],
      },
    ],
    related: ['receipts', 'wallets', 'qr', 'faq'],
    keywords: ['thanh toán', 'khách trả', 'trả tiền', 'thu tiền', 'trả hết', 'vào tài khoản', 'hình thức', 'trả thừa', 'xoá thanh toán', 'ghi nhầm', 'nộp quỹ', 'cấp trên'],
  },
  {
    id: 'receipts',
    group: 'collect',
    title: 'Một lần chuyển khoản trả nhiều vé',
    summary: 'Khách chuyển một khoản cho nhiều vé: ghi một phiếu thu, chia cho từng vé, phần thừa vào ví khách.',
    page: 'customer',
    body: [
      {
        type: 'steps',
        items: [
          'Cách 1: ở trang **Công nợ vé**, tích chọn các vé của cùng một khách → bấm **Thu tiền các vé đã chọn**.',
          'Cách 2: mở chi tiết khách hàng → bấm **Thu tiền nhiều vé**.',
          'Nhập **Số tiền khách chuyển**, chọn **Vào tài khoản**, **Ngày**, **Hình thức**.',
          'Bấm **Chia tự động (cũ trước)** để trả vé cũ trước, hoặc tự nhập số chia cho từng vé.',
          'Kiểm tra **Tổng chia** và **Phần thừa** (vào ví khách), rồi bấm **Ghi phiếu thu**.',
        ],
      },
      { type: 'warn', text: 'Ghi nhầm phiếu thu: mở chi tiết khách, ở mục **Phiếu thu nhiều vé** bấm **Xoá phiếu thu**. Các khoản trả vào vé và phần vào ví của phiếu đều bị xoá cùng lúc.' },
      {
        type: 'tips',
        items: [
          'Chỉ thu chung được cho các vé cùng 1 khách.',
          'Trong sổ tài khoản, cả phiếu thu chỉ là 1 dòng, khớp với 1 dòng trên sao kê ngân hàng.',
        ],
      },
    ],
    related: ['payments', 'wallets', 'customers', 'statement'],
    keywords: ['phiếu thu', 'nhiều vé', 'chuyển 1 lần', 'chuyển một lần', 'gộp', 'chia tự động', 'thu tiền nhiều vé', 'xoá phiếu thu'],
  },
  {
    id: 'wallets',
    group: 'collect',
    title: 'Ví trả trước',
    summary: 'Khách hoặc đại lý cấp dưới chuyển trước một khoản, mỗi lần xuất vé trừ dần vào ví.',
    page: 'wallets',
    body: [
      {
        type: 'steps',
        items: [
          'Nạp ví: mở **Ví trả trước** → **Nạp ví cho khách mới** (hoặc mở ví của khách → **Nạp tiền**). Chọn khách, nhập **Số tiền**, **Vào tài khoản**, bấm **Nạp tiền**.',
          'Trừ ví khi xuất vé: trên vé bấm **Thanh toán**, ở **Hình thức** chọn **Trừ ví trả trước**, bấm **Thêm thanh toán**.',
          'Trả lại tiền cho khách: mở ví → **Hoàn tiền**, chọn **Chi từ tài khoản**.',
          'Sửa số dư cho đúng thực tế: bấm **Điều chỉnh**, nhập số âm để trừ.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Ví của khách cũng hiện trong trang chi tiết khách hàng.',
          'Lần trừ ví ghi nhầm: xoá lần thanh toán đó trong **Thanh toán** của vé, tiền tự về ví.',
          'Thẻ **Ví âm/sắp hết** báo các ví sắp hết tiền.',
        ],
      },
    ],
    related: ['payments', 'receipts', 'customers'],
    keywords: ['ví', 'trả trước', 'nạp ví', 'nạp tiền', 'trừ ví', 'hoàn tiền', 'điều chỉnh', 'đại lý cấp dưới', 'chuyển trước', 'trừ dần', 'số dư ví'],
  },
  {
    id: 'qr',
    group: 'collect',
    title: 'Mã QR chuyển khoản',
    summary: 'Tạo mã VietQR để khách quét bằng app ngân hàng, đúng số tài khoản và số tiền.',
    page: 'accounts',
    body: [
      {
        type: 'steps',
        items: [
          'Trên thẻ tài khoản ở trang **Tài khoản**: bấm biểu tượng **Mã QR nhận tiền**.',
          'Khi ghi thanh toán một vé: bấm **Mã QR thu tiền**, mã có sẵn đúng số còn nợ.',
          'Trên **Bảng kê công nợ** của khách: chọn tài khoản ở ô **QR vào TK** để in mã kèm bảng kê.',
          'Trong khung mã QR có thể đổi **Tài khoản nhận**, **Số tiền**, **Nội dung**, rồi bấm **Sao chép** hoặc **Tải ảnh** để gửi khách.',
        ],
      },
      { type: 'warn', text: 'Tài khoản phải có **Ngân hàng / ví** chọn trong danh sách gợi ý (vd TCB, VCB, MB, ACB) và có **Số tài khoản** thì mới tạo được mã QR.' },
      {
        type: 'tips',
        items: [
          'Để trống ô **Số tiền** thì khách tự nhập số tiền khi quét.',
          '**Nội dung** nên viết không dấu, tối đa 50 ký tự.',
        ],
      },
    ],
    related: ['accounts', 'payments', 'customers'],
    keywords: ['qr', 'vietqr', 'mã qr', 'quét mã', 'chuyển khoản', 'thu tiền'],
  },

  // ------------------------------------------------------------------ Dòng tiền
  {
    id: 'accounts',
    group: 'money',
    title: 'Tài khoản & sổ tài khoản',
    summary: 'Theo dõi tiền vào/ra từng tài khoản (ngân hàng, ví, tiền mặt, TK người khác giữ hộ) để không sót đồng nào.',
    page: 'accounts',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Tài khoản** → **Thêm tài khoản**. Nhập **Tên tài khoản**, **Ngân hàng / ví**, **Số tài khoản**, **Chủ tài khoản**, **Số dư đầu**.',
          'Ở ô **Loại**: để **TK của tôi** nếu tiền là của mình; gạt sang **TK người khác giữ hộ** nếu người khác nhận tiền giúp (số dư là tiền cần thu về).',
          'Bấm vào thẻ tài khoản để mở sổ: mọi lần khách trả, trả NCC, nạp/hoàn ví, chuyển tiền, thu chi khác. Chọn **Tháng này**, **Tháng trước** hoặc **Tất cả**.',
          'Đối soát: so với sao kê ngân hàng, dòng nào khớp thì tích ô ở cột **Đối soát**. Nhiều dòng thì dùng **Khớp sao kê**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Thẻ **Chưa đối soát** đếm số giao dịch chưa tích. Đối soát đều đặn để không sót tiền.',
          'Tài khoản đã có giao dịch thì không xoá được, hãy bấm **Lưu trữ**. Bật **Hiện TK đã lưu trữ** để xem lại.',
          'Thẻ **Tiền đang ở TK người khác** là tổng tiền người khác đang giữ hộ bạn.',
        ],
      },
    ],
    related: ['transfers', 'statement', 'qr', 'expenses'],
    keywords: ['tài khoản', 'ngân hàng', 'số dư', 'sổ', 'tk người khác', 'giữ hộ', 'đối soát', 'lưu trữ', 'tiền mặt', 'momo'],
  },
  {
    id: 'transfers',
    group: 'money',
    title: 'Chuyển tiền giữa tài khoản',
    summary: 'Ghi lần chuyển tiền từ tài khoản này sang tài khoản khác, ví dụ người giữ hộ trả tiền về TK chính hoặc rút tiền mặt.',
    page: 'accounts',
    body: [
      {
        type: 'steps',
        items: [
          'Ở trang **Tài khoản** (hoặc trong sổ một tài khoản) bấm **Chuyển tiền**.',
          'Chọn **Từ tài khoản** và **Sang tài khoản**, nhập **Số tiền**, **Phí chuyển** (nếu có), **Ngày**.',
          'Bấm **Ghi chuyển tiền**. Tiền rời TK nguồn và vào TK nhận; phí chuyển trừ ở TK nguồn.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Người giữ hộ trả tiền về: trên thẻ TK giữ hộ bấm **Rút về TK chính**, số tiền điền sẵn bằng số dư.',
          '"TK chính" là tài khoản của mình đầu tiên trong danh sách.',
          'Ghi nhầm: mở sổ tài khoản và bấm **Xoá** ở dòng chuyển tiền đó.',
        ],
      },
    ],
    related: ['accounts', 'faq'],
    keywords: ['chuyển tiền', 'rút về tk chính', 'rút tiền', 'phí chuyển', 'giữ hộ', 'chuyển khoản nội bộ'],
  },
  {
    id: 'statement',
    group: 'money',
    title: 'Khớp sao kê ngân hàng',
    summary: 'Tải file sao kê ngân hàng để hệ thống tự tìm và đánh dấu đối soát các giao dịch khớp.',
    page: 'accounts',
    body: [
      {
        type: 'steps',
        items: [
          'Tải sao kê từ ngân hàng (Excel hoặc CSV).',
          'Vào **Tài khoản**, mở sổ tài khoản đó → **Khớp sao kê** → **Chọn file sao kê (.xlsx, .xls, .csv)**.',
          'Chọn cột **Ngày** và cột **Số tiền** (hoặc Ghi có / Ghi nợ) trong file.',
          'Xem danh sách: dòng **Khớp** là đã tìm thấy giao dịch cùng chiều, cùng số tiền, lệch không quá 3 ngày.',
          'Bấm **Xác nhận khớp … dòng** để đánh dấu đối soát.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Dòng **Không khớp** (phí ngân hàng, lãi…) bấm **Tạo thu/chi khác** để ghi nhanh.',
          'Chỉ các giao dịch chưa đối soát mới được đem ra so.',
        ],
      },
    ],
    related: ['accounts', 'expenses'],
    keywords: ['sao kê', 'đối soát', 'khớp', 'file ngân hàng', 'excel ngân hàng', 'csv'],
  },
  {
    id: 'expenses',
    group: 'money',
    title: 'Thu chi khác & Lãi ròng',
    summary: 'Ghi các khoản ngoài vé (phí ngân hàng, lương, văn phòng…) để Lãi ròng phản ánh đúng thực tế.',
    page: 'expenses',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Thu chi khác** → **Thêm thu/chi** (hoặc nút **Thu/chi khác** ở trang Tài khoản).',
          'Chọn **Tài khoản**, **Chiều** (**Chi** hoặc **Thu**), **Danh mục**, nhập **Số tiền**, **Ngày**, **Ghi chú**.',
          'Bấm **Ghi lại**.',
          'Xem **Lãi ròng** ở Tổng quan: lãi bán vé − chi phí khác + thu khác.',
        ],
      },
      { type: 'warn', text: 'Danh mục **Rút tiền riêng** và **Góp vốn** là tiền của chủ, không tính vào lãi/lỗ. Đừng dùng chúng cho chi phí thật.' },
      {
        type: 'tips',
        items: [
          'Lọc theo tháng, danh mục, tài khoản để xem chi phí từng loại.',
          'Ghi nhầm: bấm **Sửa** hoặc **Xoá** trên dòng.',
        ],
      },
    ],
    related: ['accounts', 'statement'],
    keywords: ['chi phí', 'thu chi', 'lãi ròng', 'phí ngân hàng', 'lương', 'văn phòng', 'quảng cáo', 'rút tiền riêng', 'góp vốn', 'điện nước'],
  },
  {
    id: 'suppliers',
    group: 'money',
    title: 'Nhà cung cấp',
    summary: 'Theo dõi còn nợ F1, bên down và các nơi lấy vé bao nhiêu, và ghi các lần trả tiền cho họ.',
    page: 'suppliers',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Nhà cung cấp** → **Thêm nhà cung cấp**: **Tên nhà cung cấp**, **Loại**, **Số điện thoại**.',
          'Khi nhập giá vốn cho vé và chọn nhà cung cấp, khoản đó tự cộng vào **Còn nợ** của họ.',
          'Trả tiền: bấm **Trả tiền** trên dòng NCC (hoặc **Trả** ở từng dòng giá vốn). Chọn **Cho dòng giá vốn** (hoặc **— Trả gộp —**), **Số tiền**, **Từ tài khoản**, bấm **Ghi trả tiền**.',
          'NCC trả lại tiền cho mình: trong khung trả tiền chọn **NCC trả lại mình**, chọn **Vào tài khoản**, bấm **Ghi nhận tiền về**.',
        ],
      },
      {
        type: 'tips',
        items: [
          '**Đang giữ của mình** nghĩa là NCC đang giữ tiền của bạn (trả dư hoặc hoàn chưa trả), cần đòi lại hoặc trừ vào lần sau.',
          'Bấm vào tên NCC để xem từng dòng giá vốn, các lần trả và hạn trả.',
          'Trả nhầm: mở NCC, bấm **Xoá lần trả**.',
        ],
      },
    ],
    related: ['cost', 'cancel', 'accounts'],
    keywords: ['nhà cung cấp', 'ncc', 'f1', 'bên down', 'trả tiền ncc', 'nợ ncc', 'đang giữ', 'trả gộp', 'ncc trả lại'],
  },

  // ------------------------------------------------------------------ Khách hàng
  {
    id: 'customers',
    group: 'customers',
    title: 'Khách hàng & Bảng kê công nợ',
    summary: 'Danh bạ khách, công nợ gộp 4 loại dịch vụ của từng khách, và bảng kê để in hoặc gửi Zalo.',
    page: 'customer',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Khách hàng**. Bấm **Thêm khách** hoặc **Import**. Khách cũng tự được tạo khi nhập vé.',
          'Bấm **Chi tiết** (hoặc bấm tên khách trong bảng vé) để xem mọi giao dịch, các lần trả, ví và tổng còn nợ. Chọn **Tháng này**, **3 tháng** hoặc **Tất cả**.',
          'Bấm **Bảng kê công nợ**. Đặt **Hạn thanh toán ghi trên bảng kê**; chọn **QR vào TK** nếu muốn in mã QR.',
          'Bấm **In / Lưu PDF** để in hoặc lưu file, hoặc **Sao chép tóm tắt** rồi dán vào Zalo gửi khách.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Bấm thẻ **Khách còn nợ** để chỉ xem khách đang nợ.',
          'Đặt **Hạn mức nợ** khi sửa khách; vượt hạn mức sẽ có cảnh báo ở trang chi tiết.',
          'Khách chuyển một lần cho nhiều vé: bấm **Thu tiền nhiều vé** ngay ở trang chi tiết.',
        ],
      },
    ],
    related: ['receipts', 'wallets', 'qr'],
    keywords: ['khách hàng', 'chi tiết khách', 'bảng kê', 'in', 'pdf', 'zalo', 'hạn mức', 'danh bạ', 'sinh nhật'],
  },

  // ------------------------------------------------------------------ Tiện ích
  {
    id: 'fare-watch',
    group: 'tools',
    title: 'Canh vé & Check vé',
    summary: 'Canh vé: theo dõi giá cho khách và báo khi tới giá mong muốn. Check vé: tra nhanh giá các hãng cho một chặng.',
    page: 'ticketWatch',
    feature: 'fareWatch',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Canh vé** → **Thêm canh vé**. Nhập khách, **Hành trình**, **Ngày đi**, **Ngày về** (có ngày về = khứ hồi), **Số khách**, **Giá mong muốn**.',
          'Bật **Tự động canh giá** để hệ thống tự lấy giá, hoặc bấm **Lấy giá ngay** trên thẻ (mất vài chục giây).',
          'Tới giá mong muốn, thẻ báo **Đã đạt giá mong muốn!**. Báo khách xong bấm **Đã báo giá**.',
          'Khách đặt: bấm **Đã đặt** → **Tạo công nợ** để tạo luôn 1 dòng trong Công nợ vé.',
          'Tra nhanh không cần lưu khách: vào **Check vé**, nhập **Hành trình** và ngày, chọn **Một chiều** hoặc **Khứ hồi (đi + về)**, bấm **Tra giá**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Để trống ô hãng thì hệ thống canh giá rẻ nhất của mọi hãng.',
          'Không thấy menu Canh vé / Check vé: tính năng chưa được bật cho tài khoản của bạn, hãy nhờ quản trị viên bật.',
          'Bấm **Lịch sử** để xem giá qua các lần canh.',
        ],
      },
    ],
    related: ['debts', 'faq'],
    keywords: ['canh vé', 'canh giá', 'check vé', 'tra giá', 'giá rẻ', 'giá mong muốn', 'báo giá', 'săn vé'],
  },
  {
    id: 'notes',
    group: 'tools',
    title: 'Ghi chú',
    summary: 'Nhắc việc nhanh, riêng tư, tự lưu khi gõ: khách cần gọi lại, việc cần làm hôm nay…',
    page: 'notes',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Ghi chú** → **Thêm ghi chú**.',
          'Gõ nội dung. Ghi chú tự lưu khi bạn gõ, không cần bấm lưu.',
          'Chọn màu để phân loại; bấm **Ghim lên đầu** cho việc quan trọng.',
          'Xong việc thì bấm **Xoá ghi chú**.',
        ],
      },
      { type: 'tips', items: ['Ghi chú chỉ mình bạn thấy.'] },
    ],
    related: ['start'],
    keywords: ['ghi chú', 'nhắc việc', 'note', 'ghim'],
  },
  {
    id: 'invoices',
    group: 'tools',
    title: 'Hoá đơn',
    summary: 'Lập hoá đơn cho khách lẻ hoặc công ty từ các vé đã bán và theo dõi trạng thái thu tiền của hoá đơn.',
    page: 'invoice',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Hóa đơn** → **Tạo hoá đơn**. Nhập **Số hoá đơn**, **Ngày lập**, **Hạn thanh toán**, chọn **Khách hàng** hoặc **Công ty**.',
          'Thêm dòng: bấm **Chọn từ vé** để lấy vé có sẵn, hoặc **Thêm dòng** rồi nhập **Mô tả**, **Số lượng**, **Đơn giá**.',
          'Bấm **Lưu hoá đơn**.',
          'Khi khách trả: mở hoá đơn, bấm **Đổi trạng thái** (Chưa thu, Thu một phần, Đã thu đủ, Đã huỷ). Bấm **In** để in.',
        ],
      },
      { type: 'warn', text: 'Trạng thái hoá đơn không ghi tiền vào vé. Tiền khách trả vẫn phải ghi bằng nút **Thanh toán** trên vé.' },
    ],
    related: ['payments', 'customers'],
    keywords: ['hoá đơn', 'hóa đơn', 'invoice', 'in hoá đơn', 'công ty'],
  },
  {
    id: 'deposits',
    group: 'tools',
    title: 'Nộp quỹ',
    summary: 'Ghi các lần nộp tiền lên đại lý cấp trên và xem còn phải nộp bao nhiêu.',
    page: 'deposit',
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Nộp quỹ** → bấm nút **Nộp quỹ**.',
          'Nhập **Ngày nộp**, **Số tiền**, chọn **Hình thức** (**Chuyển khoản**, **Tiền mặt**), bấm **Ghi nhận**.',
          'Khoản nợ cấp trên từ kỳ trước: chọn hình thức **Điều chỉnh đầu kỳ** và nhập số âm.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Lần thanh toán ghi với **Tiền này tính cho** = **Của cấp trên (tính vào nộp quỹ)** sẽ hiện ở đây (**Khách trả cấp trên**) và được tính vào số dư với cấp trên.',
          'Đại lý cấp 1 xem được các lần nộp của đại lý cấp dưới.',
        ],
      },
    ],
    related: ['payments', 'agency'],
    keywords: ['nộp quỹ', 'cấp trên', 'nộp tiền', 'đầu kỳ', 'số dư cấp trên'],
  },

  // ------------------------------------------------------------------ Quản lý
  {
    id: 'agency',
    group: 'admin',
    title: 'Quản lý đại lý',
    summary: 'Tạo tài khoản cho đại lý cấp dưới để họ tự quản lý công nợ; bạn xem tổng hợp số liệu của họ.',
    page: 'agency',
    roles: ['admin', 'agency'],
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Đại lý** → **Thêm đại lý**. Nhập **Tên đăng nhập** (không dấu), **Mật khẩu** (ít nhất 6 ký tự), **Họ và tên**, **Email**.',
          'Báo tên đăng nhập và mật khẩu cho đại lý cấp dưới qua kênh riêng.',
          'Đổi thông tin hoặc mật khẩu: bấm **Thao tác** (dấu ⋯) trên dòng → **Sửa thông tin**, **Đặt lại mật khẩu** hoặc **Gia hạn dùng thử**.',
          'Xem số liệu của cấp dưới: ở các trang như Công nợ vé, Nộp quỹ, chọn đại lý trong ô **Tất cả đại lý**.',
        ],
      },
      {
        type: 'tips',
        items: [
          'Cấp 1 chỉ xem dữ liệu của cấp 2 (nhãn **Chỉ xem**), không sửa được.',
          'Cột **Canh vé** chỉ quản trị viên bật/tắt được. Bật thì đại lý thấy menu Canh vé và Check vé.',
          '**Gia hạn dùng thử** cộng dồn số ngày; đại lý cần đăng nhập lại để áp dụng.',
        ],
      },
    ],
    related: ['deposits', 'audit', 'fare-watch'],
    keywords: ['đại lý', 'cấp dưới', 'cấp 1', 'cấp 2', 'tạo tài khoản', 'đặt lại mật khẩu', 'gia hạn', 'dùng thử', 'nhân viên'],
  },
  {
    id: 'audit',
    group: 'admin',
    title: 'Nhật ký thao tác',
    summary: 'Xem ai đã thêm, sửa, xoá, thanh toán hay đăng nhập, và vào lúc nào.',
    page: 'audit',
    roles: ['admin', 'agency'],
    body: [
      {
        type: 'steps',
        items: [
          'Vào **Nhật ký**. Danh sách hiện 200 thao tác mới nhất.',
          'Lọc bằng ô **Mọi thao tác**, **Mọi đối tượng** hoặc gõ vào ô tìm kiếm.',
          'Bấm **Xem chi tiết** để xem nội dung thay đổi; **Sao chép** để gửi cho người khác.',
        ],
      },
      { type: 'tips', items: ['Dùng để tra lại khi số liệu bị sửa hoặc xoá mà không ai nhớ.'] },
    ],
    related: ['agency'],
    keywords: ['nhật ký', 'lịch sử', 'ai sửa', 'ai xoá', 'audit', 'đăng nhập'],
  },

  // ------------------------------------------------------------------ Hỏi đáp
  {
    id: 'faq',
    group: 'faq',
    title: 'Câu hỏi thường gặp',
    summary: 'Cách xử lý nhanh các tình huống hay gặp: ghi nhầm tiền, khách chuyển nhầm, trả thừa, huỷ vé, F1 hoàn tiền…',
    body: [
      { type: 'p', text: '**Ghi nhầm số tiền khách đã trả?** Bấm **Thanh toán** trên vé, bấm biểu tượng thùng rác (**Xoá**) ở lần trả sai rồi ghi lại số đúng. Nếu lần trả có nhãn **Phiếu thu #…**, hãy xoá phiếu thu ở trang chi tiết khách.' },
      { type: 'p', text: '**Chọn nhầm tài khoản nhận tiền?** Xoá lần thanh toán đó và ghi lại với **Vào tài khoản** đúng.' },
      { type: 'p', text: '**Khách chuyển vào tài khoản của người khác?** Thêm tài khoản đó với loại **TK người khác giữ hộ**, rồi ghi thanh toán vào tài khoản này. Khi người đó trả tiền về, bấm **Rút về TK chính** trên thẻ tài khoản.' },
      { type: 'p', text: '**Khách chuyển 1 lần cho nhiều vé?** Dùng **Thu tiền nhiều vé** (xem chủ đề Một lần chuyển khoản trả nhiều vé).' },
      { type: 'p', text: '**Khách trả thừa?** Cứ ghi đủ số khách chuyển, phần thừa tự vào ví trả trước của khách để trừ vào vé sau.' },
      { type: 'p', text: '**Huỷ vé khách đã trả một phần?** Dùng **Huỷ / hoàn**, nhập phí khách chịu. **Trả lại khách** tự tính = đã trả − phí. Khách trả chưa đủ phí thì vé vẫn còn nợ, thu tiếp bằng **Thanh toán**.' },
      { type: 'p', text: '**F1 hoàn tiền cho mình?** Lúc huỷ vé, thêm dòng ở **NCC hoàn lại**. Nhận tiền sau thì vào **Nhà cung cấp**, mở F1 đó, bấm **Nhận** ở dòng hoàn (hoặc **Trả tiền** → **NCC trả lại mình**).' },
      { type: 'p', text: '**Tiền đang nằm ở TK người khác?** Xem thẻ **Tiền đang ở TK người khác** ở trang Tài khoản. Khi họ chuyển về, bấm **Rút về TK chính** để số dư hai bên khớp.' },
      { type: 'p', text: '**Vì sao lợi nhuận không tính vé này?** Vé đang bật **Chưa đủ giá vốn**, cột Lợi nhuận hiện **Chưa tính**. Nhập đủ giá vốn rồi tắt công tắc đó.' },
      { type: 'p', text: '**Không thấy menu Canh vé?** Tính năng Canh vé chưa được bật cho tài khoản của bạn. Nhờ quản trị viên bật ở trang Đại lý.' },
      { type: 'p', text: '**Quên mật khẩu?** Ở trang đăng nhập bấm **Quên mật khẩu?**, nhập email đã đăng ký, bấm **Gửi link đặt lại**. Không có email thì nhờ đại lý cấp trên hoặc quản trị viên **Đặt lại mật khẩu**. Đổi mật khẩu khi đang đăng nhập: vào **Hồ sơ** → **Đổi mật khẩu**.' },
    ],
    related: ['payments', 'receipts', 'cancel', 'cost-pending', 'transfers'],
    keywords: ['hỏi đáp', 'faq', 'ghi nhầm', 'chuyển nhầm', 'trả thừa', 'quên mật khẩu', 'mật khẩu', 'f1 hoàn', 'không thấy menu', 'lãi không tính'],
  },
];
