Add-Type -AssemblyName System.Drawing
$fixtureDir = Join-Path $PSScriptRoot '../.cache/photo-fixtures'
[IO.Directory]::CreateDirectory($fixtureDir) | Out-Null
$outline = [Drawing.Point[]]@([Drawing.Point]::new(175,75),[Drawing.Point]::new(220,60),[Drawing.Point]::new(280,60),[Drawing.Point]::new(325,75),[Drawing.Point]::new(425,150),[Drawing.Point]::new(365,225),[Drawing.Point]::new(330,200),[Drawing.Point]::new(330,435),[Drawing.Point]::new(170,435),[Drawing.Point]::new(170,200),[Drawing.Point]::new(135,225),[Drawing.Point]::new(75,150))
foreach ($kind in @('solid','stripe','check','print','back')) {
  $bitmap = [Drawing.Bitmap]::new(500,500)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([Drawing.Color]::White)
  $path = [Drawing.Drawing2D.GraphicsPath]::new(); $path.AddPolygon($outline)
  $brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(40,100,160))
  $graphics.FillPath($brush,$path); $graphics.SetClip($path)
  if ($kind -eq 'stripe' -or $kind -eq 'check') {
    for ($i=80; $i -lt 440; $i+=35) { $graphics.FillRectangle([Drawing.Brushes]::Ivory,60,$i,380,10) }
    if ($kind -eq 'check') { for ($i=90; $i -lt 430; $i+=35) { $graphics.FillRectangle([Drawing.Brushes]::Ivory,$i,50,8,400) } }
  }
  if ($kind -eq 'print' -or $kind -eq 'back') {
    $font = [Drawing.Font]::new('Arial',24,[Drawing.FontStyle]::Bold)
    $label = if ($kind -eq 'back') { 'BACK' } else { 'FRONT' }
    $graphics.DrawString($label,$font,[Drawing.Brushes]::White,185,220)
    $graphics.FillRectangle([Drawing.Brushes]::Orange,190,270,110,45)
    $font.Dispose()
  }
  $graphics.ResetClip(); $graphics.FillEllipse([Drawing.Brushes]::White,219,39,62,50)
  $bitmap.Save((Join-Path $fixtureDir ($kind+'.png')),[Drawing.Imaging.ImageFormat]::Png)
  $brush.Dispose();$path.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
Write-Output $fixtureDir
