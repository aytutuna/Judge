import SwiftUI

/// Draws a Mid in the 84 x 100 box of the approved demo: the paths of its
/// SVG (a 152 x 180 view box starting at 436, 430) scaled into the box, a
/// ground shadow under it and, when it holds one, a flag. Light mode has an
/// ink body with white eyes, dark mode the other way round.
struct MidPainter: Sendable {
    /// Seconds on the shared animation clock.
    var clock: Double
    /// False for stills: the pose stays but nothing sways, blinks or pops.
    var animated: Bool
    var dark: Bool
    var sides: Sides

    private static let k: CGFloat = 84 / 152

    /// `center` is the middle of the box and `scale` its size against the demo's.
    func paint(_ pose: MidPose, index: Int, center: CGPoint, scale: CGFloat, look: CGPoint, in context: GraphicsContext) {
        let t = clock + Double(index) * 0.3
        var box = context
        box.translateBy(x: center.x - 42 * scale, y: center.y - 50 * scale)
        box.scaleBy(x: scale, y: scale)
        shadow(in: box)

        let figure = animated ? pose.motion.figure(at: t, age: pose.age) : MidFigure()
        var fig = box
        fig.translateBy(x: 42, y: 92)
        fig.rotate(by: .degrees(figure.angle))
        fig.translateBy(x: 0, y: figure.lift)
        fig.scaleBy(x: 1, y: figure.squash)
        if pose.sits {
            fig.scaleBy(x: 1, y: 0.84)
            fig.translateBy(x: 0, y: 9)
        }
        fig.translateBy(x: -42, y: -92)

        var art = fig
        art.translateBy(x: 0, y: (100 - 180 * Self.k) / 2)
        art.scaleBy(x: Self.k, y: Self.k)
        art.translateBy(x: -436, y: -430)
        limbs(pose, t: t, in: art)
        torso(in: art)
        eyes(look: look, in: art)

        if let party = pose.flag {
            flag(party, pop: animated ? Curve.pop.at(pose.age / 0.28) : 1, in: fig)
        }
    }

    private func shadow(in box: GraphicsContext) {
        var blurred = box
        blurred.addFilter(.blur(radius: 3))
        blurred.fill(Path(ellipseIn: CGRect(x: 18, y: 91, width: 48, height: 9)), with: .color(.black.opacity(dark ? 0.35 : 0.18)))
    }

    private func limbs(_ pose: MidPose, t: Double, in art: GraphicsContext) {
        let ink = GraphicsContext.Shading.color(Brand.ink)
        let style = StrokeStyle(lineWidth: 12, lineCap: .round)
        art.stroke(Self.line(496, 548, 492, 594), with: ink, style: style)
        art.stroke(Self.line(528, 548, 532, 594), with: ink, style: style)
        switch pose.arms {
        case .down:
            art.stroke(Self.line(461, 515, 450, 548), with: ink, style: style)
            art.stroke(Self.line(563, 515, 574, 548), with: ink, style: style)
        case .wave:
            art.stroke(Self.line(461, 515, 450, 548), with: ink, style: style)
            var hand = art
            hand.translateBy(x: 562, y: 506)
            hand.rotate(by: .degrees(animated ? MidsClock.wave(t) : 0))
            hand.translateBy(x: -562, y: -506)
            hand.stroke(Self.line(562, 506, 586, 462), with: ink, style: style)
        case .up:
            art.stroke(Self.line(462, 506, 438, 462), with: ink, style: style)
            art.stroke(Self.line(562, 506, 586, 462), with: ink, style: style)
        case .hold:
            art.stroke(Self.line(461, 520, 486, 540), with: ink, style: style)
            art.stroke(Self.line(563, 520, 538, 540), with: ink, style: style)
        case .beam:
            var beam = art
            beam.translateBy(x: 512, y: 505)
            beam.rotate(by: .degrees(animated ? MidsClock.tilt(t) : 0))
            beam.translateBy(x: -512, y: -505)
            beam.stroke(Self.line(430, 505, 594, 505), with: ink, style: style)
            beam.fill(Self.disc(434, 490, 13), with: .color(sides.a.fill))
            beam.fill(Self.disc(590, 490, 13), with: .color(sides.b.fill))
        }
    }

    /// The body with its soft gloss (light from the upper left, shade at the
    /// far edge) and the small highlight.
    private func torso(in art: GraphicsContext) {
        let disc = Self.disc(512, 500, 56)
        art.fill(disc, with: .color(Brand.ink))
        let stops: [Gradient.Stop]
        if dark {
            stops = [
                Gradient.Stop(color: .white.opacity(0.5), location: 0),
                Gradient.Stop(color: .white.opacity(0), location: 0.45),
                Gradient.Stop(color: .black.opacity(0.3), location: 1),
            ]
        } else {
            stops = [
                Gradient.Stop(color: .white.opacity(0.27), location: 0),
                Gradient.Stop(color: .white.opacity(0.04), location: 0.45),
                Gradient.Stop(color: .black.opacity(0.5), location: 1),
            ]
        }
        art.fill(disc, with: .radialGradient(Gradient(stops: stops), center: CGPoint(x: 498.6, y: 477.6), startRadius: 0, endRadius: 84))

        var shine = art
        shine.translateBy(x: 492, y: 472)
        shine.rotate(by: .degrees(-24))
        shine.fill(Path(ellipseIn: CGRect(x: -15, y: -9, width: 30, height: 18)), with: .color(.white.opacity(dark ? 0.5 : 0.22)))
    }

    private func eyes(look: CGPoint, in art: GraphicsContext) {
        var eyes = art
        eyes.translateBy(x: look.x, y: look.y)
        eyes.translateBy(x: 512, y: 494)
        eyes.scaleBy(x: 1, y: animated ? MidsClock.blink(clock) : 1)
        eyes.translateBy(x: -512, y: -494)
        for x in [CGFloat(493), 531] {
            eyes.fill(Path(ellipseIn: CGRect(x: x - 8.5, y: 480.5, width: 17, height: 27)), with: .color(Brand.paper))
        }
    }

    /// A pole and a pennant in the side's colour, popping up from its middle.
    private func flag(_ party: Party, pop: Double, in fig: GraphicsContext) {
        guard pop > 0 else { return }
        var flag = fig
        flag.translateBy(x: 75, y: 10)
        flag.scaleBy(x: pop, y: pop)
        flag.translateBy(x: -75, y: -10)
        flag.translateBy(x: 60, y: -12)
        flag.stroke(Self.line(4, 2, 4, 42), with: .color(Brand.ink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        var cloth = Path()
        cloth.move(to: CGPoint(x: 5, y: 3))
        cloth.addLine(to: CGPoint(x: 26, y: 3))
        cloth.addLine(to: CGPoint(x: 20, y: 11))
        cloth.addLine(to: CGPoint(x: 26, y: 19))
        cloth.addLine(to: CGPoint(x: 5, y: 19))
        cloth.closeSubpath()
        flag.fill(cloth, with: .color(sides.of(party).fill))
    }

    private static func line(_ ax: CGFloat, _ ay: CGFloat, _ bx: CGFloat, _ by: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: ax, y: ay))
        path.addLine(to: CGPoint(x: bx, y: by))
        return path
    }

    private static func disc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
    }
}

/// One frame of the New page's stage: the Mids roam an area inset so that
/// the jumps, the shadows and a tilt all stay inside, and look down at the
/// box while someone types (`gaze` is 0 at rest, 1 looking down).
struct PlaygroundFrame: Sendable {
    var painter: MidPainter
    var wander: MidsWander
    var gaze: Double

    func draw(_ context: GraphicsContext, size: CGSize) {
        let u = min(1, size.height / 260)
        let g = CGFloat(gaze)
        let area = CGRect(x: 48 * u, y: 76 * u, width: size.width - 96 * u, height: size.height - 130 * u)
        let placed = (0..<3).map { index -> (index: Int, pose: MidPose, center: CGPoint) in
            let pose = wander.pose(mid: index, at: painter.clock)
            let center = CGPoint(x: area.minX + pose.position.x * area.width, y: area.minY + pose.position.y * area.height)
            return (index, pose, center)
        }
        for mid in placed.sorted(by: { $0.center.y < $1.center.y }) {
            let look = CGPoint(x: mid.pose.look.x * (1 - g), y: mid.pose.look.y * (1 - g) + 7 * g)
            painter.paint(mid.pose, index: mid.index, center: mid.center, scale: u, look: look, in: context)
        }
    }
}

/// One frame of the judging card, drawn in a 340 x 255 space fitted to the
/// canvas. The page the Mids read lies behind them, the magnifying glass in
/// front.
struct JudgingFrame: Sendable {
    var painter: MidPainter
    var shift: MidsShift
    var flags: [Party?]
    /// Reference-date seconds.
    var now: Double

    func draw(_ context: GraphicsContext, size: CGSize) {
        let stage = shift.stage
        let scale = min(size.width / JudgingStage.size.width, size.height / JudgingStage.size.height)
        var space = context
        space.translateBy(x: (size.width - JudgingStage.size.width * scale) / 2, y: (size.height - JudgingStage.size.height * scale) / 2)
        space.scaleBy(x: scale, y: scale)

        let animated = painter.animated
        let positions = animated ? shift.positions(at: now) : stage.targets
        let moving = animated && shift.moving(at: now)
        let age = animated ? now - shift.since : 0
        let poses = (0..<3).map { index in
            stage.pose(index, moving: moving, age: age, flag: flags.indices.contains(index) ? flags[index] : nil)
        }

        if stage == .read || stage == .examine {
            paper(in: space, opacity: stage == .read && animated ? min(1, age / 0.4) : 1)
        }
        for index in (0..<3).sorted(by: { positions[$0].y < positions[$1].y }) {
            painter.paint(poses[index], index: index, center: positions[index], scale: 1, look: poses[index].look, in: space)
        }
        if stage == .examine {
            glass(in: space)
        }
    }

    private func paper(in space: GraphicsContext, opacity: Double) {
        var page = space
        page.opacity = opacity
        let rect = CGRect(x: 124, y: 138, width: 92, height: 110)
        var shadow = page
        shadow.addFilter(.blur(radius: 6))
        shadow.fill(Path(roundedRect: rect.offsetBy(dx: 0, dy: 6), cornerRadius: 10), with: .color(.black.opacity(0.14)))
        page.fill(Path(roundedRect: rect, cornerRadius: 10), with: .color(Brand.paper))
        page.stroke(Path(roundedRect: rect, cornerRadius: 10), with: .color(Brand.ink.opacity(0.14)), lineWidth: 1)
        for row in 0..<6 {
            let share: CGFloat = row == 0 ? 0.74 : row == 3 ? 0.58 : 1
            let color = row == 0 ? painter.sides.a.fill : row == 3 ? painter.sides.b.fill : Brand.strata
            let line = CGRect(x: rect.minX + 10, y: rect.minY + 12 + 13 * CGFloat(row), width: 72 * share, height: 6)
            page.fill(Path(roundedRect: line, cornerRadius: 3), with: .color(color))
        }
    }

    private func glass(in space: GraphicsContext) {
        let sweep = MidsClock.scan(painter.animated ? painter.clock : 0)
        var lens = space
        lens.translateBy(x: 128 + sweep.x, y: 140 + sweep.y)
        lens.scaleBy(x: 46 / 48, y: 46 / 48)
        let ring = Path(ellipseIn: CGRect(x: 7, y: 7, width: 26, height: 26))
        lens.fill(ring, with: .color(painter.sides.a.fill.opacity(0.22)))
        lens.stroke(ring, with: .color(Brand.ink), lineWidth: 4)
        var handle = Path()
        handle.move(to: CGPoint(x: 30, y: 30))
        handle.addLine(to: CGPoint(x: 43, y: 43))
        lens.stroke(handle, with: .color(Brand.ink), style: StrokeStyle(lineWidth: 5, lineCap: .round))
    }
}
