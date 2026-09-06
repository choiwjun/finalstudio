$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Decode-Utf8Base64([string]$value) {
  [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
}

function Save-RangePicture($range, [string]$path) {
  $range.CopyPicture(1, 2)
  Start-Sleep -Milliseconds 700
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image) {
    throw "Excel range was not available on the clipboard."
  }

  try {
    $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $image.Dispose()
  }
}

$orderSheetName = Decode-Utf8Base64 '7KO866y47ISc'
$productsSheetName = Decode-Utf8Base64 '7IOB7ZKI66qp66Gd'
$codeHeader = Decode-Utf8Base64 '7IOB7ZKIIOy9lOuTnA=='
$nameHeader = Decode-Utf8Base64 '7IOB7ZKI66qF'
$priceHeader = Decode-Utf8Base64 '6rCA6rKp'
$notebook = Decode-Utf8Base64 '64W47Yq4'
$pen = Decode-Utf8Base64 '67O87Y6c'

$root = Join-Path $env:TEMP 'wj-blog-excel-qa'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$workbookPath = Join-Path $root 'vlookup-real-test.xlsx'
$ordersImagePath = Join-Path $root 'excel-vlookup-orders.png'
$productsImagePath = Join-Path $root 'excel-vlookup-products.png'
$summaryPath = Join-Path $root 'vlookup-real-test.json'

foreach ($path in @($workbookPath, $ordersImagePath, $productsImagePath, $summaryPath)) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
  }
}

$excel = $null
$book = $null
$verifyBook = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Add()

  $orders = $book.Worksheets.Item(1)
  $orders.Name = $orderSheetName
  $products = $book.Worksheets.Add()
  $products.Name = $productsSheetName

  $orders.Range('A1').Value2 = $codeHeader
  $orders.Range('B1').Value2 = $nameHeader
  $orders.Range('C1').Value2 = $priceHeader
  $orders.Range('A2').Value2 = 'P001'
  $orders.Range('A3').Value2 = 'P002'

  $products.Range('A1').Value2 = $codeHeader
  $products.Range('B1').Value2 = $nameHeader
  $products.Range('C1').Value2 = $priceHeader
  $products.Range('A2').Value2 = 'P001'
  $products.Range('B2').Value2 = $notebook
  $products.Range('C2').Value2 = 3000
  $products.Range('A3').Value2 = 'P002'
  $products.Range('B3').Value2 = $pen
  $products.Range('C3').Value2 = 1500

  foreach ($sheet in @($orders, $products)) {
    $sheet.Range('A1:C1').Font.Bold = $true
    $sheet.Range('A1:C3').Borders.LineStyle = 1
    $sheet.Range('A1:C3').Font.Size = 14
    $sheet.Range('A1:C3').Rows.RowHeight = 26
    $sheet.Columns.Item('A').ColumnWidth = 16
    $sheet.Columns.Item('B').ColumnWidth = 18
    $sheet.Columns.Item('C').ColumnWidth = 16
  }

  $orders.Range('B2').Formula = "=VLOOKUP(A2,$productsSheetName!`$A`$2:`$C`$100,2,FALSE)"
  $orders.Range('C2').Formula = "=VLOOKUP(A2,$productsSheetName!`$A`$2:`$C`$100,3,FALSE)"
  $orders.Range('B3').Formula = "=VLOOKUP(A3,$productsSheetName!`$A`$2:`$C`$100,2,FALSE)"
  $orders.Range('C3').Formula = "=VLOOKUP(A3,$productsSheetName!`$A`$2:`$C`$100,3,FALSE)"

  $missingCell = $orders.Range('E2')
  $missingCell.Formula = '=VLOOKUP("P999",' + $productsSheetName + '!$A$2:$C$100,2,FALSE)'
  $invalidColumnCell = $orders.Range('E3')
  $invalidColumnCell.Formula = "=VLOOKUP(A2,$productsSheetName!`$A`$2:`$C`$100,4,FALSE)"

  $excel.CalculateFullRebuild()
  Save-RangePicture $orders.Range('A1:C3') $ordersImagePath
  Save-RangePicture $products.Range('A1:C3') $productsImagePath
  $book.SaveAs($workbookPath, 51)
  $book.Close($false)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book)
  $book = $null

  $verifyBook = $excel.Workbooks.Open($workbookPath, $null, $true)
  $verifyOrders = $verifyBook.Worksheets.Item($orderSheetName)
  $summary = [ordered]@{
    excelVersion = $excel.Version
    excelBuild = [int]$excel.Build
    workbook = $workbookPath
    sheets = @($verifyBook.Worksheets.Item(1).Name, $verifyBook.Worksheets.Item(2).Name)
    result = [ordered]@{
      productNameP001 = $verifyOrders.Range('B2').Text
      priceP001 = $verifyOrders.Range('C2').Text
      productNameP002 = $verifyOrders.Range('B3').Text
      priceP002 = $verifyOrders.Range('C3').Text
    }
    errorCases = [ordered]@{
      missingCode = $verifyOrders.Range('E2').Text
      invalidColumn = $verifyOrders.Range('E3').Text
    }
    screenshots = @($ordersImagePath, $productsImagePath)
  }
  $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  $summary | ConvertTo-Json -Depth 5
} finally {
  if ($null -ne $verifyBook) {
    $verifyBook.Close($false)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($verifyBook)
  }
  if ($null -ne $book) {
    $book.Close($false)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book)
  }
  if ($null -ne $excel) {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
