import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import lottie from 'lottie-web';

interface LottieViewProps {
  source: any;
  autoPlay?: boolean;
  loop?: boolean;
  style?: any;
  resizeMode?: string;
  [key: string]: any;
}

const WebLottieView: React.FC<LottieViewProps> = ({
  source,
  autoPlay = true,
  loop = true,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !source) return;

    try {
      if (animRef.current) {
        animRef.current.destroy();
      }

      animRef.current = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: loop !== false,
        autoplay: autoPlay !== false,
        animationData: typeof source === 'string' ? JSON.parse(source) : source,
      });
    } catch (err) {
      console.warn('[WebLottieView] Failed to load animation:', err);
    }

    return () => {
      if (animRef.current) {
        animRef.current.destroy();
        animRef.current = null;
      }
    };
  }, [source, autoPlay, loop]);

  return (
    <View style={[styles.container, style]}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default WebLottieView;
